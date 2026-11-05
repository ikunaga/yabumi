// 相談を終えて元の画面に戻ったときの知らせ（?done=consult_closed&items=n&reviewed=<やることの id>|many。docs/architecture.md の 4.23）。
// n は終えたときにサーバーが数えた、この相談で入れた来週のやることの数。決まった文だけを出す（URL の文をそのまま出さない）。
// 済みにしたやることの名前は、URL ではなく DB から読んだもの（本人の、済みのやることだけ）
export const CONSULT_CLOSED_DONE = "consult_closed";

export type ReviewedNotice = { title: string } | "many" | null;

export function consultClosedText(done: unknown, items: unknown, reviewed: ReviewedNotice = null): string | null {
  if (done !== CONSULT_CLOSED_DONE) return null;
  const n = typeof items === "string" && /^[1-9]\d?$/.test(items) ? Number(items) : 0;
  const parts = ["相談を終えました。"];
  if (reviewed && reviewed !== "many") parts.push(`『${reviewed.title}』を済みにしました。`);
  if (n > 0) parts.push(`来週のやることに ${n} 件入れました。`);
  if (reviewed === "many") parts.push("今週の振り返りのやることが 2 つ以上あるので、ロードマップで済みにしてください。");
  return parts.join("");
}
