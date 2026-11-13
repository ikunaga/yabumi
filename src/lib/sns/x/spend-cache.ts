import "server-only";
import { jstMonth } from "./send-rules";

// 投稿をつくるの X の上限の見込み（checkXSend）で読む、今月の X の額の読み方（2026-11-13 の 2 回目のセキュリティ確認 App-L2）。
// checkXSend は 1 回で admin の RPC を 2 本流すので、直接連打されても DB に負荷をかけないよう、利用者 1 人あたり 1 分に 20 回まで
// （サーバーの 1 台あたり）読み直す。超えたら、その分の終わりまで最後に読んだ額を返す。
// ふつうに使う分（② と ⑤ に入る・押したとき）は毎回読み直す（押したときに今の額で判定し直す。PMO2 の 3 回目の 02b）。
// 同じ利用者の同時の呼び出しは、読み込み中の 1 本を待つ。送るときの判定（savePost・送信ジョブ）は、ここを通さず毎回 DB を見る。
// 月（日本時間）が替わったら、回数に関わらず読み直す
export type XSpend = { mine: number; total: number };

export const X_SPEND_WINDOW_MS = 60_000;
export const X_SPEND_LOADS_PER_WINDOW = 20;
// 覚えておく利用者の数の上限（古いものから捨てる。メモリを使いすぎない）
export const X_SPEND_CACHE_MAX = 1000;

type Entry = { windowStart: number; loads: number; month: string; last: Promise<XSpend>; loading: boolean };
const cache = new Map<string, Entry>();

export function cachedXSpend(ownerId: string, load: () => Promise<XSpend>, now: number = Date.now()): Promise<XSpend> {
  const month = jstMonth(new Date(now));
  const e = cache.get(ownerId);
  if (e && e.month === month) {
    // 読み込み中なら、それを待つ
    if (e.loading) return e.last;
    const inWindow = now - e.windowStart >= 0 && now - e.windowStart < X_SPEND_WINDOW_MS;
    if (inWindow && e.loads >= X_SPEND_LOADS_PER_WINDOW) return e.last;
  }
  const keep = e && e.month === month && now - e.windowStart >= 0 && now - e.windowStart < X_SPEND_WINDOW_MS;
  const spend = load();
  const entry: Entry = { windowStart: keep ? e!.windowStart : now, loads: keep ? e!.loads + 1 : 1, month, last: spend, loading: true };
  cache.delete(ownerId);
  cache.set(ownerId, entry);
  spend.then(
    () => {
      entry.loading = false;
    },
    // 読めなかったときは覚えない（次の呼び出しで読み直す）
    () => {
      if (cache.get(ownerId) === entry) cache.delete(ownerId);
    },
  );
  while (cache.size > X_SPEND_CACHE_MAX) cache.delete(cache.keys().next().value!);
  return spend;
}

// テスト用
export function clearXSpendCache(): void {
  cache.clear();
}
