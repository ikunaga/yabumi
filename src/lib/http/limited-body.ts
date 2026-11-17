// 外から届くリクエストの本文を、上限の大きさまでだけ読む（セキュリティ確認 7121224 以降の L3）。
// Content-Length が上限を超えていれば読まずに断り、書いていない・偽っているときも、読んだ量が上限を超えたところで止める
// （request.text() は全部を読むまで止まらないので、大きな本文でメモリと時間を使わせられる）。上限を超えたら null
export async function readLimitedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}
