// 相談を終えて元の画面に戻ったときの知らせ（?done=consult_closed&items=n。docs/architecture.md の 4.23）。
// n は終えたときにサーバーが数えた、この相談で入れた来週のやることの数。決まった文だけを出す（URL の文をそのまま出さない）
export const CONSULT_CLOSED_DONE = "consult_closed";

export function consultClosedText(done: unknown, items: unknown): string | null {
  if (done !== CONSULT_CLOSED_DONE) return null;
  const n = typeof items === "string" && /^[1-9]\d?$/.test(items) ? Number(items) : 0;
  return n > 0 ? `相談を終えました。来週のやることに ${n} 件入れました。` : "相談を終えました。";
}
