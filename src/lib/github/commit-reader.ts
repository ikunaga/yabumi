import type { CommitDetail, CommitSummary } from "./api";
import { isReadableFilePath, redactSecrets } from "./repo-reader";

// 最近のコミットを、投稿のネタの材料にする形に整える（要求 F04。docs/architecture.md の 4.15）。
// 秘密の除外と伏せ字は、紹介文の下書き（4.10）と同じもの（isReadableFilePath、redactSecrets）を通す。
// 整えた中身は AI に渡すだけで、保存しない。

// 選べる期間（日）。既定は 1 週間
export const IDEA_PERIODS = [3, 7, 14, 30] as const;
export type IdeaPeriod = (typeof IDEA_PERIODS)[number];
export const DEFAULT_IDEA_PERIOD: IdeaPeriod = 7;

// AI に見せるコミットの数（メッセージと変えたファイル）と、差分まで読むコミットの数。AI の費用を抑えるための上限
export const MAX_COMMITS = 40;
export const MAX_DETAILED_COMMITS = 15;
export const MAX_MESSAGE_CHARS = 1_000;
export const MAX_FILES_PER_COMMIT = 30;
export const MAX_PATCH_CHARS_PER_FILE = 1_500;
export const MAX_PATCH_CHARS_PER_COMMIT = 4_000;
export const MAX_PATCH_CHARS_TOTAL = 24_000;

export type CommitDigest = {
  sha: string;
  date: string;
  message: string;
  // 読んでよいファイルだけ。秘密が入りがちなファイルは名前も出さない
  files: { path: string; status: string; additions: number; deletions: number }[];
  // 差分（伏せ字にしたもの）。読まなかったコミットは空
  patch: string;
  patchTruncated: boolean;
};

export function isValidPeriod(v: unknown): v is IdeaPeriod {
  return (IDEA_PERIODS as readonly number[]).includes(v as number);
}

// マージのコミットと、bot（dependabot など）のコミットは材料にしない
export function isWorthReading(c: CommitSummary): boolean {
  if (c.parents.length > 1) return false;
  const login = c.author?.login ?? "";
  if (c.author?.type === "Bot" || login.endsWith("[bot]")) return false;
  return true;
}

// メッセージの末尾の Co-Authored-By: などはメールアドレスが入るので落とし、秘密らしき文字列を伏せ、長さで切る
export function cleanMessage(message: string): string {
  const lines = message
    .split("\n")
    .filter((l) => !/^\s*(co-authored-by|signed-off-by|reviewed-by|reported-by|cc):/i.test(l))
    .join("\n")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[メールアドレス]")
    .trim();
  const redacted = redactSecrets(lines);
  return redacted.length > MAX_MESSAGE_CHARS ? `${redacted.slice(0, MAX_MESSAGE_CHARS)}…` : redacted;
}

function commitDate(c: CommitSummary): string {
  return c.commit.author?.date ?? c.commit.committer?.date ?? "";
}

// 1 つのコミットの詳細から、読んでよいファイルと差分を取り出す。budget: 残りの差分の文字数
export function digestCommit(c: CommitDetail, budget: number): CommitDigest {
  const readable = (c.files ?? []).filter((f) => isReadableFilePath(f.filename));
  const files = readable.slice(0, MAX_FILES_PER_COMMIT).map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }));

  const limit = Math.min(MAX_PATCH_CHARS_PER_COMMIT, Math.max(0, budget));
  let patch = "";
  let truncated = readable.length > MAX_FILES_PER_COMMIT;
  for (const f of readable.slice(0, MAX_FILES_PER_COMMIT)) {
    if (!f.patch) continue;
    if (f.patch.includes("\u0000")) continue;
    const redacted = redactSecrets(f.patch);
    const part = redacted.length > MAX_PATCH_CHARS_PER_FILE ? `${redacted.slice(0, MAX_PATCH_CHARS_PER_FILE)}\n…（以下略）` : redacted;
    if (redacted.length > MAX_PATCH_CHARS_PER_FILE) truncated = true;
    const block = `--- ${f.filename}\n${part}\n`;
    if (patch.length + block.length > limit) {
      truncated = true;
      break;
    }
    patch += block;
  }
  return { sha: c.sha, date: commitDate(c), message: cleanMessage(c.commit.message), files, patch: patch.trimEnd(), patchTruncated: truncated };
}

export type CommitSource = {
  list: (since: Date) => Promise<CommitSummary[]>;
  get: (sha: string) => Promise<CommitDetail>;
};

export type ReadCommitsResult = { commits: CommitDigest[]; truncated: boolean };

// 期間のコミットを新しい順に読み、上限までにする。差分は新しいものから MAX_DETAILED_COMMITS 件まで読む
export async function readRecentCommits(source: CommitSource, since: Date): Promise<ReadCommitsResult> {
  const all = (await source.list(since)).filter(isWorthReading);
  const picked = all.slice(0, MAX_COMMITS);
  const commits: CommitDigest[] = [];
  let budget = MAX_PATCH_CHARS_TOTAL;
  for (const [i, c] of picked.entries()) {
    if (i < MAX_DETAILED_COMMITS && budget > 0) {
      try {
        const d = digestCommit(await source.get(c.sha), budget);
        budget -= d.patch.length;
        commits.push(d);
        continue;
      } catch {
        // 詳細が読めなければ、メッセージだけ使う
      }
    }
    commits.push({ sha: c.sha, date: commitDate(c), message: cleanMessage(c.commit.message), files: [], patch: "", patchTruncated: false });
  }
  return { commits, truncated: all.length > MAX_COMMITS };
}
