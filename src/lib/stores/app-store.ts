import { createPrivateKey, sign } from "node:crypto";
import { gunzipSync } from "node:zlib";

// App Store Connect API の Sales and Trends（docs/architecture.md の 4.22）。
// 鍵は利用者が App Store Connect で作る「Team の API キー」（役割は Sales and Reports）: Issuer ID、Key ID、秘密鍵（.p8）と、ベンダー番号。
// 呼ぶたびに秘密鍵で JWT（ES256、15 分）を作る。トークンは保存しない

export const ASC_API = "https://api.appstoreconnect.apple.com";

export type AscCredential = { issuerId: string; keyId: string; privateKey: string; vendorNumber: string };

export class StoreApiError extends Error {
  constructor(
    // 画面に出す、利用者向けの説明
    readonly userMessage: string,
    readonly status: number,
  ) {
    super(userMessage);
    this.name = "StoreApiError";
  }
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

export function ascJwt(cred: AscCredential, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = { alg: "ES256", kid: cred.keyId, typ: "JWT" };
  // 有効は 20 分まで（Apple の決まり）。余裕を見て 15 分
  const payload = { iss: cred.issuerId, iat, exp: iat + 15 * 60, aud: "appstoreconnect-v1" };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(cred.privateKey);
  const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(signature)}`;
}

// 入れてもらった値の形を確かめる（呼ぶ前に、明らかな入れ間違いを知らせる）
export function checkAscFormat(c: AscCredential): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.issuerId.trim())) return "Issuer ID の形が違います（例: 57246542-96fe-1a63-e053-0824d011072a）。";
  if (!/^[A-Z0-9]{8,12}$/.test(c.keyId.trim())) return "Key ID の形が違います（英大文字と数字の 10 文字ほど。例: 2X9R4HXF34）。";
  if (!/^[0-9]{6,12}$/.test(c.vendorNumber.trim())) return "ベンダー番号は数字です（例: 85123456）。";
  if (!/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(c.privateKey)) return "秘密鍵は、ダウンロードした .p8 ファイルの中身（-----BEGIN PRIVATE KEY----- から -----END PRIVATE KEY----- まで）です。";
  try {
    createPrivateKey(c.privateKey);
  } catch {
    return "秘密鍵として読めませんでした。.p8 ファイルの中身をそのまま貼ってください。";
  }
  return null;
}

// 日ごとの売上のレポート（SALES・SUMMARY・DAILY）。その日に売上もダウンロードもなければ null（Apple は 404 を返す）
export async function fetchDailySales(cred: AscCredential, reportDate: string, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<Record<string, string>[] | null> {
  const url = new URL(`${ASC_API}/v1/salesReports`);
  url.searchParams.set("filter[frequency]", "DAILY");
  url.searchParams.set("filter[reportType]", "SALES");
  url.searchParams.set("filter[reportSubType]", "SUMMARY");
  url.searchParams.set("filter[vendorNumber]", cred.vendorNumber.trim());
  url.searchParams.set("filter[reportDate]", reportDate);
  url.searchParams.set("filter[version]", "1_0");
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${ascJwt(cred, now)}`, Accept: "application/a-gzip" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { errors?: { detail?: string }[] };
    const detail = body.errors?.[0]?.detail ?? "";
    if (res.status === 401) throw new StoreApiError("鍵が使えませんでした。Issuer ID・Key ID・秘密鍵が同じキーのものか、キーが取り消されていないかを確かめてください。", 401);
    if (res.status === 403) throw new StoreApiError("このキーには売上のレポートを読む権限がありません。役割が「Sales and Reports」（または Admin・Finance）の Team キーを作ってください。", 403);
    if (res.status === 400) throw new StoreApiError(`App Store Connect が受け付けませんでした。ベンダー番号を確かめてください。${detail ? `（${detail}）` : ""}`, 400);
    if (res.status === 429) throw new StoreApiError("App Store Connect の回数の上限にかかりました。時間をおいて読み直します。", 429);
    throw new StoreApiError(`App Store Connect から読めませんでした（${res.status}）。時間をおいて読み直します。`, res.status);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8");
  return parseTsv(text);
}

export function parseTsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split("\t").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

// 製品の種類（Product Type Identifier）。https://developer.apple.com/help/app-store-connect/reference/reporting/product-type-identifiers
const FIRST_DOWNLOAD = new Set(["1", "1F", "1T", "F1", "1E", "1EP", "1EU"]);
const REDOWNLOAD = new Set(["3", "3F", "3T", "F3"]);
const UPDATE = new Set(["7", "7F", "7T", "F7"]);
const IN_APP = new Set(["IA1", "IA9", "IAY", "IAC", "FI1", "IA1-M", "IA9-M", "IAY-M"]);

export type AppStoreDay = { downloads: number; redownloads: number; updates: number; iap_units: number; proceeds: Record<string, number> };

// 1 日のレポートを、アプリ（Apple ID）ごとの数字にまとめる。appleId がなければレポートのすべて（ベンダーのアプリが 1 つのとき）。
// アプリ内課金の行は、アプリの SKU（同じ日のアプリの行から）を親に持つものだけを数える
export function summarizeSales(rows: Record<string, string>[], appleId: string | null): AppStoreDay {
  const day: AppStoreDay = { downloads: 0, redownloads: 0, updates: 0, iap_units: 0, proceeds: {} };
  const appRows = appleId ? rows.filter((r) => r["Apple Identifier"] === appleId) : rows.filter((r) => !IN_APP.has(r["Product Type Identifier"]));
  const skus = new Set(appRows.map((r) => r["SKU"]).filter(Boolean));
  const iapRows = rows.filter((r) => IN_APP.has(r["Product Type Identifier"]) && (!appleId || skus.has(r["Parent Identifier"])));
  for (const r of [...appRows, ...iapRows]) {
    const type = r["Product Type Identifier"];
    const units = Number(r["Units"]) || 0;
    if (FIRST_DOWNLOAD.has(type)) day.downloads += units;
    else if (REDOWNLOAD.has(type)) day.redownloads += units;
    else if (UPDATE.has(type)) day.updates += units;
    else if (IN_APP.has(type)) day.iap_units += units;
    // 売上（手数料を引いたあとの受け取り）。1 個あたりの Developer Proceeds × 数（返金はマイナスの数）
    const proceeds = Number(r["Developer Proceeds"]) || 0;
    const currency = r["Currency of Proceeds"];
    if (proceeds && currency) day.proceeds[currency] = Math.round(((day.proceeds[currency] ?? 0) + proceeds * units) * 100) / 100;
  }
  return day;
}

// App Store の URL から Apple ID（id123456789 の数字）を読む
export function appleIdFromUrl(url: string | null): string | null {
  const m = url?.match(/\/id(\d{5,})/);
  return m ? m[1] : null;
}

// 太平洋時間の日付（Apple のレポートの日付）。days 日前
export function pacificDate(now: Date, daysAgo = 0): string {
  const d = new Date(now.getTime() - daysAgo * 86_400_000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Los_Angeles" }).format(d);
}
