import type { SnsKey } from "./index";

// ハッシュタグの決まり（2026-10-20 に各社の資料で確かめた。docs/architecture.md の 4.15）。
// 下書きを出す AI への指示（post-ideas・consult）と、AI の下書きの後始末（tidyDraftHashtags）に使う。
// - X: いくつでも付けられるが、公式のヘルプが 2 つまでをすすめている
// - Threads: 1 投稿に 1 つ（トピックタグ）。本文の 1 つ目がトピックになって名前の横に出て、本文ではその # が外れる。2 つ目からはタグにならず文字のまま（2026-11-12 の実際の投稿で確かめた）
// - Instagram: 2025 年 12 月から 1 投稿 5 個まで（投稿と Reels。コメントに書いた分も数える）。超えると送れないか、外される
// - Facebook・TikTok・YouTube: はっきりした上限は小さくないが、少なく付けるのが目安（YouTube は 15 個を超えると全部が無視される）
export const HASHTAG_RULES: Record<SnsKey, { max: number; text: string }> = {
  x: { max: 2, text: "1〜2 個まで（X のヘルプのすすめ）" },
  threads: { max: 1, text: "1 つまで（Threads は 1 つ目のタグがトピックになり、2 つ目からはタグにならず文字のまま出る）" },
  instagram: { max: 5, text: "5 個まで（Instagram の決まり。ネタに合うものだけなら 1〜3 個でよい）" },
  facebook: { max: 2, text: "1〜2 個まで（目安）" },
  tiktok: { max: 3, text: "3 個まで（目安）" },
  youtube: { max: 3, text: "3 個まで（目安。タイトルの上に出るのは最初の 3 個）" },
  note: { max: 3, text: "3 個まで（目安）" },
  substack: { max: 0, text: "付けない" },
};

// 先頭の # / ＃ は外して持つ。タグの途中に空白や記号があると、SNS がそこでタグを切ってしまう
export function normalizeHashtag(raw: string): string {
  return raw.trim().replace(/^[#＃]+/, "").trim();
}
export function isValidHashtag(tag: string): boolean {
  return /^[\p{L}\p{N}\p{M}_]+$/u.test(tag);
}

// ===== 毎回付けるタグ（投稿の SNS ごとのタグ・投稿のフォーマットのタグ。docs/architecture.md の 4.59） =====
// 本文とは別に持ち、送るときに本文の後ろに足す。数と長さの正は DB（20261112130000_post_hashtags の check）
export const MAX_TARGET_HASHTAGS = 5;
export const MAX_HASHTAG_LENGTH = 50;

// 本文の末尾の空白（DB の post_target_text と同じ文字）
const TRAILING_SPACE = /[ \t\r\n\u3000]+$/;

export function hashtagLine(tags: readonly string[]): string {
  return tags.map((t) => `#${t}`).join(" ");
}

// 送る文: 本文（SNS ごとの文面があればそれ）の後ろに、空行をはさんでタグの行を足す。タグがなければ本文のまま、本文が空ならタグの行だけ。
// DB の post_target_text（送信ジョブが送る文）と同じ結果にする（tests/post-hashtags.integration.test.ts で比べる）
export function withHashtags(text: string, tags: readonly string[]): string {
  if (tags.length === 0) return text;
  const head = text.replace(TRAILING_SPACE, "");
  return head ? `${head}\n\n${hashtagLine(tags)}` : hashtagLine(tags);
}

// 保存した配信先の送る文（DB の行から。送信ジョブの claim_due_targets と同じ組み立て）
export function targetText(body: string, t: { body_override: string | null; hashtags?: readonly string[] | null }): string {
  return withHashtags(t.body_override ?? body, t.hashtags ?? []);
}

// 欄に書いたタグを読む。空白・読点・カンマで区切り、先頭の # は外す。同じタグ（大文字・小文字の違いだけのものも）は 1 つにする。
// invalid: タグにできない言葉（記号が入っている・50 字を超える）
export function parseHashtagInput(raw: string): { tags: string[]; invalid: string[] } {
  const tags: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,、，]+/u)) {
    const tag = normalizeHashtag(part);
    if (!tag) continue;
    if (!isValidHashtag(tag) || [...tag].length > MAX_HASHTAG_LENGTH) {
      invalid.push(tag);
      continue;
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return { tags, invalid };
}

// 欄の問題（送れない理由）。合っていれば null
export function hashtagInputProblem(raw: string): string | null {
  const { tags, invalid } = parseHashtagInput(raw);
  const bad = invalid[0];
  if (bad !== undefined) {
    if (isValidHashtag(bad)) return `タグは 1 つ ${MAX_HASHTAG_LENGTH} 字までです`;
    return `「${bad}」はタグにできません（記号は入れられません）`;
  }
  if (tags.length > MAX_TARGET_HASHTAGS) return `タグは ${MAX_TARGET_HASHTAGS} 個までです`;
  return null;
}

// 本文の中のハッシュタグ。直前が文字・数字・_ ・& のものは数えない（issue#12、&#123; など）
const HASHTAG_RE = /(^|[^\p{L}\p{N}_&])([#＃])([\p{L}\p{N}\p{M}_]+)/gu;

export function extractHashtags(text: string): string[] {
  return [...text.matchAll(HASHTAG_RE)].map((m) => m[3]);
}

// AI の下書きのハッシュタグを、設計で選んだもの（allowed、# なし）だけ・SNS の上限までにする。
// 外すタグが、タグだけの行にあれば消し、文の途中にあれば # だけを外して言葉は残す（文が崩れないように）
export function tidyDraftHashtags(text: string, allowed: string[], sns: SnsKey): string {
  const ok = new Set(allowed.map((t) => t.toLowerCase()));
  const max = HASHTAG_RULES[sns].max;
  let kept = 0;
  const keep = new Set<number>();
  for (const m of text.matchAll(HASHTAG_RE)) {
    const at = m.index + m[1].length;
    if (ok.has(m[3].toLowerCase()) && kept < max) {
      keep.add(at);
      kept++;
    }
  }
  // 行ごとに直す（位置は行の先頭からの位置で見る）
  let offset = 0;
  const lines = text.split("\n").map((line) => {
    const start = offset;
    offset += line.length + 1;
    const tagOnly = line.replace(HASHTAG_RE, "$1").trim() === "";
    if (!line.match(HASHTAG_RE)) return line;
    const out = line.replace(HASHTAG_RE, (all, pre: string, mark: string, tag: string, i: number) => {
      if (keep.has(start + i + pre.length)) return all;
      return tagOnly ? pre : `${pre}${tag}`;
    });
    return tagOnly ? out.replace(/[ \t　]{2,}/g, " ").trim() : out;
  });
  // タグを消して空になった行は、続く空行ごと 1 つにまとめ、末尾の空行は消す
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}
