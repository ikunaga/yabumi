// 画像に重ねる見出しの文を、描ける形にそろえる（docs/design/auto-sample-image.md の 11.。段取り ④。サーバーで描くときと、画面に出すときで同じ）。
// - 絵文字は取り除く（サーバーの書体に絵文字がないため。2026-11-20 PM の決定 a）。旗・肌の色・つなぎの字も取り除く
// - URL・【】・改行などの制御文字も取り除き、空白は 1 つにそろえる。40 字まで（画面の見出しの欄と同じ）
export const HEADLINE_TEXT_MAX = 40;

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu;
const URL = /https?:\/\/\S+|www\.\S+/gi;

export function cleanHeadline(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw
    .replace(URL, " ")
    .replace(EMOJI, "")
    .replace(/【[^【】]*】/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...s].slice(0, HEADLINE_TEXT_MAX).join("").trim();
}
