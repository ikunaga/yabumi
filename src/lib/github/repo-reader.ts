import type { TreeEntry } from "./api";

// リポジトリから、アプリの説明の下書きに使うファイルを選んで読む（docs/architecture.md の 4.10）。
// 読んだ中身は AI に渡すだけで、保存しない。

// 1 ファイルと全体の上限（文字数）。AI の費用を抑えるため
export const MAX_FILE_CHARS = 15_000;
export const MAX_TOTAL_CHARS = 50_000;
// AI が選べるファイルの数の上限
export const MAX_PICKED_FILES = 15;
// AI に見せるファイル一覧の上限（件数）。多すぎると①の費用が増える
export const MAX_LISTED_PATHS = 600;
// GitHub のツリーで見える大きさ（バイト）がこれを超えるファイルは読まない
export const MAX_FILE_BYTES = 200_000;
const MAX_DOCS = 8;

// 秘密情報が入りがちなファイルは、名前だけで除く（中身を読まない）
const SECRET_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /\.(pem|key|p8|p12|pfx|cer|crt|der|keystore|jks|mobileprovision|provisionprofile)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|\/)google-services\.json$/i,
  /(^|\/)GoogleService-Info\.plist$/i,
  /(^|\/)(credentials?|secrets?|service[-_]?account)[^/]*$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)local\.properties$/i,
  /(^|\/)key\.properties$/i,
];

// 読まない場所（依存物や生成物）
const IGNORED_DIRS = /(^|\/)(node_modules|vendor|Pods|build|dist|\.next|\.git|DerivedData|\.dart_tool|\.gradle|Carthage)\//;

export function isSecretPath(path: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(path));
}

// 文字として読めないファイル（画像、フォント、動画、圧縮ファイルなど）と、読んでも役に立たない巨大な自動生成物
const NON_TEXT = /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|psd|ai|sketch|fig|ttf|otf|woff2?|eot|mp3|mp4|mov|wav|m4a|aac|ogg|webm|zip|gz|tgz|bz2|xz|7z|rar|jar|aar|apk|aab|ipa|dmg|exe|dll|so|dylib|a|o|class|pdf|car|xcassets|db|sqlite|realm)$/i;
const LOCKFILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Podfile\.lock|Gemfile\.lock|Cargo\.lock|pubspec\.lock|composer\.lock|poetry\.lock)$/i;

// 読んでよいファイル（秘密・依存物・文字でないもの・大きすぎるものを除く）。AI に見せる一覧も、AI が選んだものも、必ずこれを通す
export function isReadablePath(e: TreeEntry): boolean {
  return (
    e.type === "blob" &&
    !IGNORED_DIRS.test(e.path) &&
    !isSecretPath(e.path) &&
    !NON_TEXT.test(e.path) &&
    !LOCKFILES.test(e.path) &&
    (e.size ?? 0) <= MAX_FILE_BYTES
  );
}

// ①で AI に見せるファイル一覧。浅いものから並べ、上限で切る
export function listCandidates(entries: TreeEntry[]): { files: { path: string; size: number }[]; truncated: boolean } {
  const readable = entries
    .filter(isReadablePath)
    .map((e) => ({ path: e.path, size: e.size ?? 0 }))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  return { files: readable.slice(0, MAX_LISTED_PATHS), truncated: readable.length > MAX_LISTED_PATHS };
}

// AI が選んだファイルを確かめる。一覧にないもの・読んではいけないものは捨て、上限で切る
export function validatePicks(picks: string[], entries: TreeEntry[]): string[] {
  const allowed = new Map(entries.filter(isReadablePath).map((e) => [e.path, e]));
  const out: string[] = [];
  for (const p of picks) {
    const path = p.trim().replace(/^\.?\//, "");
    if (allowed.has(path) && !out.includes(path)) out.push(path);
    if (out.length >= MAX_PICKED_FILES) break;
  }
  return out;
}

// 優先度つきで選ぶ。数字が小さいほど先に読む
function priority(path: string): number | null {
  const lower = path.toLowerCase();
  const depth = path.split("/").length - 1;
  if (depth === 0 && /^readme(\.[a-z-]+)?\.(md|markdown|txt|rst)$/i.test(path)) return 0;
  if (depth === 0 && /^(claude|agents)\.md$/i.test(path)) return 1;
  if (/(^|\/)fastlane\/metadata\/[^/]+\/(ja|en-us|default)\/(name|subtitle|description|promotional_text)\.txt$/i.test(path)) return 1;
  if (depth === 0 && ["package.json", "app.json", "pubspec.yaml", "cargo.toml"].includes(lower)) return 2;
  // モノレポ: 各アプリのフォルダ（apps/web、front など）の README と設定
  if (depth <= 2 && /(^|\/)readme\.(md|markdown)$/i.test(path)) return 2 + depth;
  if (depth <= 2 && /(^|\/)(package\.json|app\.json|pubspec\.yaml)$/i.test(path)) return 3 + depth;
  if (/(^|\/)info\.plist$/i.test(path) && !/(tests?|uitests?|extension|widget)/i.test(path)) return 3;
  if (/(^|\/)app\/build\.gradle(\.kts)?$/i.test(path)) return 3;
  if (/(^|\/)src\/main\/androidmanifest\.xml$/i.test(path)) return 4;
  if (/^docs\/.+\.(md|markdown)$/i.test(path)) return 5 + depth;
  return null;
}

// AI が選べなかったときの予備の選び方（決まった名前のファイル）
export function selectFiles(entries: TreeEntry[]): string[] {
  const candidates = entries
    .filter(isReadablePath)
    .map((e) => ({ path: e.path, p: priority(e.path) }))
    .filter((e): e is { path: string; p: number } => e.p !== null)
    .sort((a, b) => a.p - b.p || a.path.length - b.path.length || a.path.localeCompare(b.path));

  const picked: string[] = [];
  let docs = 0;
  let plists = 0;
  for (const c of candidates) {
    if (picked.length >= MAX_PICKED_FILES) break;
    const isDoc = /^docs\//i.test(c.path);
    const isPlist = /info\.plist$/i.test(c.path);
    if (isDoc && docs >= MAX_DOCS) continue;
    if (isPlist && plists >= 1) continue;
    if (isDoc) docs++;
    if (isPlist) plists++;
    picked.push(c.path);
  }
  return picked;
}

// 念のため、鍵やトークンらしき文字列を伏せる（設定ファイルに直接書かれていることがある）
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g,
];
// "apiKey": "..." のような、名前から秘密とわかる値
const SECRET_ASSIGNMENT = /("?(?:api[_-]?key|secret|token|password|private[_-]?key)"?\s*[:=]\s*)(?:"[^"]{8,}"|'[^']{8,}')/gi;

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_VALUE_PATTERNS) out = out.replace(re, "[伏せました]");
  return out.replace(SECRET_ASSIGNMENT, (_m, prefix: string) => `${prefix}"[伏せました]"`);
}

export type RepoFile = { path: string; content: string; truncated: boolean };

// 選んだファイルを順に読み、上限まで集める
export async function readSelectedFiles(paths: string[], readFile: (path: string) => Promise<string>): Promise<{ files: RepoFile[]; skipped: string[] }> {
  const files: RepoFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const path of paths) {
    if (total >= MAX_TOTAL_CHARS) {
      skipped.push(path);
      continue;
    }
    let text: string;
    try {
      text = await readFile(path);
    } catch {
      skipped.push(path);
      continue;
    }
    if (text.includes("\u0000")) {
      skipped.push(path);
      continue;
    }
    const limit = Math.min(MAX_FILE_CHARS, MAX_TOTAL_CHARS - total);
    const redacted = redactSecrets(text);
    const content = redacted.length > limit ? redacted.slice(0, limit) : redacted;
    files.push({ path, content, truncated: redacted.length > limit });
    total += content.length;
  }
  return { files, skipped };
}
