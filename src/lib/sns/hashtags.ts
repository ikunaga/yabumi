import type { SnsKey } from "./index";

// ハッシュタグの決まり（2026-10-20 に各社の資料で確かめた。docs/architecture.md の 4.15）。
// 下書きを出す AI への指示（post-ideas・consult）と、AI の下書きの後始末（tidyDraftHashtags）に使う。
// - X: いくつでも付けられるが、公式のヘルプが 2 つまでをすすめている
// - Threads: 1 投稿に 1 つ（トピックタグ）。2 つ目からはタグにならない
// - Instagram: 2025 年 12 月から 1 投稿 5 個まで（投稿と Reels。コメントに書いた分も数える）。超えると送れないか、外される
// - Facebook・TikTok・YouTube: はっきりした上限は小さくないが、少なく付けるのが目安（YouTube は 15 個を超えると全部が無視される）
export const HASHTAG_RULES: Record<SnsKey, { max: number; text: string }> = {
  x: { max: 2, text: "1〜2 個まで（X のヘルプのすすめ）" },
  threads: { max: 1, text: "1 つまで（Threads は 1 投稿に 1 つしかタグにならない）" },
  instagram: { max: 5, text: "5 個まで（Instagram の決まり。ネタに合うものだけなら 1〜3 個でよい）" },
  facebook: { max: 2, text: "1〜2 個まで（目安）" },
  tiktok: { max: 3, text: "3 個まで（目安）" },
  youtube: { max: 3, text: "3 個まで（目安。タイトルの上に出るのは最初の 3 個）" },
  note: { max: 3, text: "3 個まで（目安）" },
  substack: { max: 0, text: "付けない" },
};

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
