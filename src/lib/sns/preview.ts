import { SNS_KEYS, type SnsKey } from "./index";

// 投稿をつくる画面の「見え方」（SNS ごとのプレビュー）。本物そっくりではなく、改行・長さ・画像の並び・折りたたみ・字数の上限が SNS ごとにわかる程度

// 見え方を切り替えるタブ。送り先に選んだ SNS だけを並べる（選んでいなければ全部）。いま見ている SNS がタブになければ最初のタブ
export function previewTabs(chosen: SnsKey[], focus: SnsKey): { tabs: SnsKey[]; active: SnsKey } {
  const tabs = chosen.length ? SNS_KEYS.filter((s) => chosen.includes(s)) : [...SNS_KEYS];
  return { tabs, active: tabs.includes(focus) ? focus : tabs[0] };
}

// 画像の並び
export type PreviewLayout = "after_grid" | "after_row" | "before" | "video" | "article";

export type PreviewSpec = {
  layout: PreviewLayout;
  // 本文を折りたたむ行数と、続きを出すボタンの文言（SNS の画面と同じ）。null は全文を出す
  fold: { lines: number; more: string } | null;
  // その SNS での出方の説明（見え方の「?」で出す）
  note: string;
  // 小さなカードに出す、ひとことの注意（見本 B の右下）
  short: string;
};

export const PREVIEW: Record<SnsKey, PreviewSpec> = {
  x: { layout: "after_grid", fold: null, note: "X は本文のあとに画像が 4 枚まで並びます。上限の字数までなら、全文が出ます。", short: "画像は本文のあと 4 枚まで" },
  threads: { layout: "after_row", fold: null, note: "Threads は本文のあとに画像が横に並び、横にめくって見ます。", short: "画像は横に並ぶ" },
  instagram: { layout: "before", fold: { lines: 2, more: "続きを読む" }, note: "Instagram は画像が先に出て、本文は 2 行で折りたたまれます。最初の 2 行で読みたくなるように。", short: "画像が先・本文は 2 行で折りたたみ" },
  facebook: { layout: "after_grid", fold: { lines: 5, more: "もっと見る" }, note: "Facebook は長い本文が 5 行ほどで折りたたまれ、そのあとに画像が並びます。", short: "5 行で折りたたみ・画像はあと" },
  tiktok: { layout: "video", fold: { lines: 2, more: "もっと見る" }, note: "TikTok は動画の上に説明が 2 行ほど出ます（動画の添付は準備中）。", short: "縦の動画が必要（準備中）" },
  youtube: { layout: "video", fold: { lines: 3, more: "もっと見る" }, note: "YouTube は動画の下の説明が 3 行ほどで折りたたまれます（動画の添付は準備中）。", short: "動画が必要（準備中）" },
  note: { layout: "article", fold: null, note: "note はタイトルと本文の記事になります。画像は投稿の画面で手で添えます。", short: "タイトルと記事・手で投稿" },
  substack: { layout: "article", fold: null, note: "Substack はタイトルと本文の記事（メールでも届きます）になります。画像は投稿の画面で手で添えます。", short: "タイトルと記事・手で投稿" },
};

// 1 行に入るおおよその字数（プレビューの幅で、全角の字）。折りたたむかどうかの目安にだけ使う
const CHARS_PER_LINE = 26;

// 折りたたんだときに見える部分。改行と、1 行に入りきらない長い行の折り返しを数える。折りたたまなければ folded: false
export function foldText(text: string, fold: PreviewSpec["fold"]): { shown: string; folded: boolean } {
  if (!fold) return { shown: text, folded: false };
  const out: string[] = [];
  let used = 0;
  for (const line of text.split("\n")) {
    const chars = [...line];
    const rows = Math.max(1, Math.ceil(chars.length / CHARS_PER_LINE));
    if (used + rows <= fold.lines) {
      out.push(line);
      used += rows;
      continue;
    }
    const room = fold.lines - used;
    if (room > 0) out.push(chars.slice(0, room * CHARS_PER_LINE - 1).join(""));
    return { shown: out.join("\n").trimEnd(), folded: true };
  }
  return { shown: text, folded: false };
}

// 本文の中の URL とハッシュタグ（プレビューで色を付ける）。それ以外は text
export function previewSegments(text: string): { kind: "text" | "url" | "tag"; value: string }[] {
  const re = /(https?:\/\/[^\s]+|[#＃][^\s#＃!-/:-@[-^`{-~、。！？「」]+)/gu;
  const out: { kind: "text" | "url" | "tag"; value: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ kind: "text", value: text.slice(last, m.index) });
    out.push({ kind: m[0].startsWith("http") ? "url" : "tag", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}
