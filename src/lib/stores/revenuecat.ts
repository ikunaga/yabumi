import { StoreApiError } from "./app-store";

// RevenueCat の REST API v2 の概要の数字（docs/architecture.md の 4.22）。
// 鍵は利用者が RevenueCat で作る v2 のシークレットキー（Charts & Metrics の読み取りの権限だけ）と、プロジェクトの ID

export const RC_API = "https://api.revenuecat.com/v2";

export type RevenueCatCredential = { projectId: string; secretKey: string };

export function checkRevenueCatFormat(c: RevenueCatCredential): string | null {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(c.projectId.trim())) return "プロジェクトの ID の形が違います（RevenueCat のプロジェクトの設定にある ID。例: proj1ab2c3d4）。";
  if (!/^sk_[A-Za-z0-9]{10,}$/.test(c.secretKey.trim())) return "シークレットキーは sk_ で始まる値です（API keys の画面で作った v2 のキー）。";
  return null;
}


// 概要の数字（MRR、直近 28 日の売上、有効な定期購入、試用中、新しい客など）。金額は currency（既定は円）で返る
export async function fetchOverview(
  cred: RevenueCatCredential,
  currency = "JPY",
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, number>> {
  const url = new URL(`${RC_API}/projects/${encodeURIComponent(cred.projectId.trim())}/metrics/overview`);
  url.searchParams.set("currency", currency);
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${cred.secretKey.trim()}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    if (res.status === 401) throw new StoreApiError("RevenueCat のシークレットキーが使えませんでした。v2 のキーか、取り消されていないかを確かめてください。", 401);
    if (res.status === 403) throw new StoreApiError("このキーには数字を読む権限がありません。キーの権限で「Charts & Metrics」を読めるようにしてください。", 403);
    if (res.status === 404) throw new StoreApiError("RevenueCat のプロジェクトが見つかりませんでした。プロジェクトの ID を確かめてください。", 404);
    if (res.status === 429) throw new StoreApiError("RevenueCat の回数の上限にかかりました。時間をおいて読み直します。", 429);
    throw new StoreApiError(`RevenueCat から読めませんでした（${res.status}）。時間をおいて読み直します。`, res.status);
  }
  const json = (await res.json()) as { metrics?: { id?: string; value?: unknown }[] };
  const values: Record<string, number> = {};
  for (const m of json.metrics ?? []) {
    if (typeof m.id === "string" && /^[a-z0-9_]{1,40}$/.test(m.id) && typeof m.value === "number" && Number.isFinite(m.value)) values[m.id] = m.value;
  }
  return values;
}
