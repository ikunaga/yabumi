import { applyFix, type AiCheckResult } from "@/lib/ai/ai-check";
import { overLimit } from "@/lib/ai/shorten";
import { displayLength, type SnsKey } from "@/lib/sns";
import { extractHashtags, HASHTAG_RULES, splitTagsByText, withHashtags } from "@/lib/sns/hashtags";
import type { AutoRunReason } from "./types";

// 自動の回の送る前のチェック（docs/design/auto-post.md の 2.5）。AI を呼ばない部分と、AI っぽさチェックの結果の扱い

export type Issue = { kind: AutoRunReason; detail: string };
export type Texts = Partial<Record<SnsKey, string>>;

// ===== 重なり（文字の 3-gram の Jaccard） =====

// 比べる前にそろえる: 全角半角・大文字小文字、空白、ハッシュタグ・URL（同じタグや URL だけで似ているとしない）
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#＃][^\s#＃]+/g, "")
    .replace(/\s+/g, "");
}

export function trigrams(text: string): Set<string> {
  const chars = [...normalize(text)];
  const out = new Set<string>();
  for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(""));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const g of a) if (b.has(g)) both++;
  return both / (a.size + b.size - both);
}

// 「似すぎ」の線。X は「ほぼ同じ投稿」を禁じている（自動化のルール。4.2）ので厳しく
export const SIMILAR_THRESHOLD = { x: 0.5, other: 0.7 } as const;
export const thresholdOf = (sns: SnsKey) => (sns === "x" ? SIMILAR_THRESHOLD.x : SIMILAR_THRESHOLD.other);

// 同じ SNS に直近に送った本文と比べて、いちばん似ているものの値
export function maxSimilarity(text: string, recent: readonly string[]): number {
  const a = trigrams(text);
  return recent.reduce((m, r) => Math.max(m, jaccard(a, trigrams(r))), 0);
}

// ===== AI を呼ばないチェック =====

const URL_RE = /https?:\/\/[^\s<>"'）)]+/gi;
// スキームのないドメイン（X などは「example.com」だけでもリンクにする）。日本語などのドメイン（例え.jp・.日本）も拾う。
// 本文は先に NFKC にそろえる（全角の「．」「ｊｐ」を「.」「jp」に）。判定は https:// を付けた URL のホスト（punycode）で、urlAllowed がする
const BARE_DOMAIN_RE = /(?<![\p{L}\p{N}@./-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:xn--[a-z0-9-]{1,59}|\p{L}{2,24})(?:\/[^\s<>"'）)]*)?/giu;

// 本文の URL が、登録した行き先のどれかの中か。前方一致の文字列では比べない（https://shop.example.com.evil.org/ を通さない）。
// オリジン（スキーム・ホスト・ポート）が同じで、パスが行き先のパスの中（「/」の区切りで）にあり、ユーザー名・パスワードがないこと
export function urlAllowed(raw: string, allowed: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password || !["https:", "http:"].includes(u.protocol)) return false;
  return allowed.some((a) => {
    let d: URL;
    try {
      d = new URL(a);
    } catch {
      return false;
    }
    if (d.origin !== u.origin) return false;
    const base = d.pathname.endsWith("/") ? d.pathname : `${d.pathname}/`;
    return u.pathname === d.pathname || u.pathname.startsWith(base);
  });
}

// 本文にある、リンクになりうるもの（スキームつきの URL と、スキームのないドメイン）のうち、行き先の外のもの
export function foreignLinks(text: string, allowed: readonly string[]): string[] {
  const out: string[] = [];
  text = text.normalize("NFKC");
  const withScheme = text.match(URL_RE) ?? [];
  for (const u of withScheme) if (!urlAllowed(u, allowed)) out.push(u);
  const rest = text.replace(URL_RE, " ");
  for (const d of rest.match(BARE_DOMAIN_RE) ?? []) if (!urlAllowed(`https://${d}`, allowed)) out.push(d);
  return out;
}

// 字数（縮めたあとも超えていれば）・【】・材料にない URL・ハッシュタグの数・前の投稿との重なり。
// tags: 本文とは別に付くタグ（シリーズのフォーマット・いつものタグ）。字数とタグの数は、送る文（本文＋空行＋タグの行。本文にもあるタグは行に付けない）で数える。
// 重なりは本文だけで比べる（毎回同じタグの行で「似すぎ」にならないように。前の投稿の本文もタグなし）
export function plainIssues(texts: Texts, opts: { allowedUrls: readonly string[]; recent: Partial<Record<SnsKey, string[]>>; tags?: Partial<Record<SnsKey, string[]>> }): Issue[] {
  const issues: Issue[] = [];
  for (const [k, body] of Object.entries(texts) as [SnsKey, string][]) {
    if (!body.trim()) {
      issues.push({ kind: "cannot_write", detail: `${k} の文がありません` });
      continue;
    }
    const keep = splitTagsByText(body, opts.tags?.[k] ?? []).keep;
    const sent = withHashtags(body, keep);
    if (overLimit(k, sent) > 0) issues.push({ kind: "too_long", detail: `${k} の字数の上限を超えています` });
    if (/[【】]/.test(body)) issues.push({ kind: "made_up", detail: `${k} に、あなたが書き足すところ（【】）が残っています` });
    if (foreignLinks(body, opts.allowedUrls).length) issues.push({ kind: "check_failed", detail: `${k} に、行き先として登録していない URL があります` });
    // 利用者が決めたタグ（keep）は、目安より多くても止めない（投稿をつくると同じく目安の注意だけ）。AI が本文に足した分で目安を超えたら止める
    if (extractHashtags(sent).length > Math.max(HASHTAG_RULES[k].max, keep.length)) issues.push({ kind: "check_failed", detail: `${k} のハッシュタグが多すぎます` });
    if (maxSimilarity(body, opts.recent[k] ?? []) >= thresholdOf(k)) issues.push({ kind: "similar", detail: `${k} の文が、前に送った投稿と似ています` });
  }
  return issues;
}

// ===== AI っぽさチェックの結果の扱い（A2 の ②） =====
// 事実か確かめて（made_up）・やらないこと（avoid）は直さずに下書きへ。それ以外（決まり文句・誇張〈あおり・効き目の約束を含む〉・口調・タグ・そのほか）は、
// 指摘の直しを当てる。当てられない直しは、下書きへ（人が見ないで出すので、直せないものは出さない）

export function applyAiCheck(texts: Texts, result: AiCheckResult): { texts: Texts; hold: Issue | null; fixed: number } {
  const hard = result.findings.find((f) => f.kind === "made_up" || f.kind === "avoid");
  if (hard) return { texts, hold: { kind: hard.kind === "made_up" ? "made_up" : "avoid", detail: hard.why.slice(0, 200) }, fixed: 0 };
  const out: Texts = { ...texts };
  let fixed = 0;
  for (const f of result.findings) {
    // 同じ文面の SNS はまとめて確かめているので、同じ文の SNS すべてに当てる
    const source = texts[f.sns];
    let hit = false;
    for (const [k, t] of Object.entries(out) as [SnsKey, string][]) {
      if (texts[k] !== source) continue;
      const next = applyFix(t, f.quote, f.fix);
      if (next !== null) {
        out[k] = next;
        hit = true;
      }
    }
    if (!hit) return { texts, hold: { kind: "check_failed", detail: `直せないところがありました: ${f.why}`.slice(0, 200) }, fixed: 0 };
    fixed++;
  }
  return { texts: out, hold: null, fixed };
}

// 本文の後ろに付くタグの行の字数（空行＋「#a #b」。タグがなければ 0）
export function tagReserve(sns: SnsKey, tags: readonly string[]): number {
  return tags.length ? displayLength(sns, withHashtags("x", tags)) - displayLength(sns, "x") : 0;
}
