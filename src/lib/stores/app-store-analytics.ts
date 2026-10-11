import { gunzipSync } from "node:zlib";
import { ASC_API, ascJwt, parseTsv, StoreApiError, type AscCredential } from "./app-store";

// App Store Connect の Analytics Reports（ストアのページの閲覧数。docs/architecture.md の 4.22）。
// https://developer.apple.com/documentation/analytics-reports
// 依頼（ONGOING）を作れるのは Admin のキーだけ。矢書は Admin のキーを保存せず、作るときに 1 回だけ使う。
// 読むのは、預かっている Sales and Reports のキー（読めるかは【未確認】。読めなければ画面に理由を出す）

type Fetch = typeof fetch;

async function asc<T>(cred: AscCredential, path: string, init: RequestInit = {}, fetchImpl: Fetch = fetch, now = new Date()): Promise<{ status: number; json: T }> {
  const res = await fetchImpl(`${ASC_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${ascJwt(cred, now)}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, json };
}

function ascError(status: number, what: string): StoreApiError {
  if (status === 401) return new StoreApiError(`${what}: 鍵が使えませんでした。Issuer ID・Key ID・秘密鍵が同じキーのものか確かめてください。`, 401);
  if (status === 403) return new StoreApiError(`${what}: このキーには権限がありません。`, 403);
  return new StoreApiError(`${what}: App Store Connect から読めませんでした（${status}）。時間をおいて読み直します。`, status);
}

type Resource = { id: string; attributes?: Record<string, unknown> };

// アプリの、続けて作られる（ONGOING）依頼があればその ID。なければ作る（Admin のキーで）
export async function ensureOngoingRequest(adminCred: AscCredential, appAppleId: string, fetchImpl: Fetch = fetch, now = new Date()): Promise<string> {
  const existing = await asc<{ data?: Resource[] }>(adminCred, `/v1/apps/${encodeURIComponent(appAppleId)}/analyticsReportRequests?filter[accessType]=ONGOING`, {}, fetchImpl, now);
  if (existing.status === 403) throw new StoreApiError("このキーでは依頼を作れません。役割が「Admin」のキーを使ってください（保存はしません）。", 403);
  if (existing.status === 404) throw new StoreApiError("App Store のアプリが見つかりませんでした。プロジェクトの App Store の URL（id の数字）を確かめてください。", 404);
  if (existing.status >= 300) throw ascError(existing.status, "依頼を確かめられませんでした");
  const found = existing.json.data?.find((r) => !(r.attributes as { stoppedDueToInactivity?: boolean } | undefined)?.stoppedDueToInactivity);
  if (found) return found.id;
  const created = await asc<{ data?: Resource }>(
    adminCred,
    "/v1/analyticsReportRequests",
    {
      method: "POST",
      body: JSON.stringify({ data: { type: "analyticsReportRequests", attributes: { accessType: "ONGOING" }, relationships: { app: { data: { type: "apps", id: appAppleId } } } } }),
    },
    fetchImpl,
    now,
  );
  if (created.status === 403) throw new StoreApiError("このキーでは依頼を作れません。役割が「Admin」のキーを使ってください（保存はしません）。", 403);
  if (created.status >= 300 || !created.json.data?.id) throw ascError(created.status, "依頼を作れませんでした");
  return created.json.data.id;
}

// ページの閲覧のレポート（App Store Discovery and Engagement の Standard）の日ごとの回のうち、processingDate が since より後のもの（古い順）
export async function listDailyInstances(cred: AscCredential, requestId: string, since: string | null, fetchImpl: Fetch = fetch, now = new Date()): Promise<{ id: string; processingDate: string }[]> {
  const reports = await asc<{ data?: Resource[] }>(cred, `/v1/analyticsReportRequests/${encodeURIComponent(requestId)}/reports?filter[category]=APP_STORE_ENGAGEMENT`, {}, fetchImpl, now);
  if (reports.status >= 300) throw ascError(reports.status, "ストアのページの閲覧数");
  const names = (reports.json.data ?? []).map((r) => ({ id: r.id, name: String(r.attributes?.name ?? "") }));
  // Detailed は 5 未満を省いてノイズを足すので、Standard を使う
  const report = names.find((r) => /discovery and engagement/i.test(r.name) && /standard/i.test(r.name)) ?? names.find((r) => /discovery and engagement/i.test(r.name));
  if (!report) return []; // 依頼から 1〜2 日はまだない
  const instances = await asc<{ data?: Resource[] }>(cred, `/v1/analyticsReports/${encodeURIComponent(report.id)}/instances?filter[granularity]=DAILY&limit=50`, {}, fetchImpl, now);
  if (instances.status >= 300) throw ascError(instances.status, "ストアのページの閲覧数");
  return (instances.json.data ?? [])
    .map((r) => ({ id: r.id, processingDate: String(r.attributes?.processingDate ?? "") }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.processingDate) && (!since || r.processingDate > since))
    .sort((a, b) => a.processingDate.localeCompare(b.processingDate));
}

// 1 回分（instance）を読み、日ごとのページの閲覧（Page view）と表示（Impression）の回数にする。同じ日付は後の回の数字で上書きする
export async function readInstance(cred: AscCredential, instanceId: string, fetchImpl: Fetch = fetch, now = new Date()): Promise<Record<string, { page_views: number; impressions: number }>> {
  const segments = await asc<{ data?: Resource[] }>(cred, `/v1/analyticsReportInstances/${encodeURIComponent(instanceId)}/segments`, {}, fetchImpl, now);
  if (segments.status >= 300) throw ascError(segments.status, "ストアのページの閲覧数");
  const days: Record<string, { page_views: number; impressions: number }> = {};
  for (const seg of segments.json.data ?? []) {
    const url = String(seg.attributes?.url ?? "");
    if (!url.startsWith("https://")) continue;
    const res = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw ascError(res.status, "ストアのページの閲覧数");
    const buf = Buffer.from(await res.arrayBuffer());
    const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8");
    for (const row of parseTsv(text)) {
      const date = row["Date"];
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const d = (days[date] ??= { page_views: 0, impressions: 0 });
      const counts = Number(row["Counts"]) || 0;
      if (/^page ?view$/i.test(row["Event"] ?? "")) d.page_views += counts;
      else if (/^impression$/i.test(row["Event"] ?? "")) d.impressions += counts;
    }
  }
  return days;
}
