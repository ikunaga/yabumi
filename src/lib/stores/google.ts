import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { StoreApiError } from "./app-store";

// Google Play の一括レポートを読むための Google Cloud の呼び出し（docs/architecture.md の 4.22、決定 D21）。
// オーナーの Google Cloud のプロジェクトに「管理用」のサービスアカウントを 1 つ置き（鍵は環境変数 GOOGLE_PLAY_MANAGER_KEY）、
// 利用者ごとにサービスアカウントを作る。読むときは、管理用のアカウントが利用者ごとのアカウントになりかわり、10 分だけの読み取りのトークンを作る。
// 利用者ごとのアカウントの鍵は作らない（預からない）

export type ManagerKey = { client_email: string; private_key: string; project_id: string };

export function managerKeyFromEnv(raw: string | undefined = process.env.GOOGLE_PLAY_MANAGER_KEY): ManagerKey | null {
  if (!raw) return null;
  try {
    const key = JSON.parse(raw) as Partial<ManagerKey>;
    if (!key.client_email || !key.private_key || !key.project_id) return null;
    return { client_email: key.client_email, private_key: key.private_key, project_id: key.project_id };
  } catch {
    return null;
  }
}

export function googlePlayConfigured(): boolean {
  return managerKeyFromEnv() !== null;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

// 管理用のアカウントのトークン（JWT bearer grant。1 時間）
export async function managerAccessToken(key: ManagerKey, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iss: key.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }),
  );
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), createPrivateKey(key.private_key));
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${payload}.${b64url(signature)}` }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !json.access_token) throw new StoreApiError("Google Play との連携は準備中です（運営者の設定を確かめています）。", res.status || 500);
  return json.access_token;
}

async function google<T>(url: string, token: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<{ status: number; json: T }> {
  const res = await fetchImpl(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, json };
}

// 利用者ごとのサービスアカウントの ID（英小文字で始まる 6〜30 字）
export function newAccountId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const tail = [...randomBytes(14)].map((b) => alphabet[b % alphabet.length]).join("");
  return `yabumi-${tail}`;
}

export async function createServiceAccount(key: ManagerKey, token: string, accountId: string, displayName: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { status, json } = await google<{ email?: string; error?: { message?: string } }>(
    `https://iam.googleapis.com/v1/projects/${encodeURIComponent(key.project_id)}/serviceAccounts`,
    token,
    { method: "POST", body: JSON.stringify({ accountId, serviceAccount: { displayName: displayName.slice(0, 100), description: "矢書（yabumi）が Google Play の一括レポートを読むためのアカウント" } }) },
    fetchImpl,
  );
  if (status === 429 || /quota/i.test(json.error?.message ?? "")) {
    throw new StoreApiError("Google Play の連携の数が上限に達しました。運営者に知らせてください。", 429);
  }
  if (status >= 300 || !json.email) throw new StoreApiError("Google Play 用のアカウントを作れませんでした。時間をおいてもう一度お試しください。", status);
  return json.email;
}

export async function deleteServiceAccount(token: string, email: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const { status } = await google(`https://iam.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email)}`, token, { method: "DELETE" }, fetchImpl);
  if (status >= 300 && status !== 404) throw new StoreApiError(`Google Play 用のアカウントを消せませんでした（${status}）`, status);
}

// 利用者ごとのアカウントになりかわって、Cloud Storage を読むだけの 10 分のトークンを作る
export async function impersonate(token: string, email: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { status, json } = await google<{ accessToken?: string }>(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email)}:generateAccessToken`,
    token,
    { method: "POST", body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/devstorage.read_only"], lifetime: "600s" }) },
    fetchImpl,
  );
  if (status >= 300 || !json.accessToken) throw new StoreApiError("Google Play 用のアカウントを使えませんでした。時間をおいてもう一度お試しください（作ったばかりなら 1〜2 分かかります）。", status);
  return json.accessToken;
}

const GCS = "https://storage.googleapis.com/storage/v1";

function storageError(status: number): StoreApiError {
  if (status === 401 || status === 403) {
    return new StoreApiError("一括レポートを読めませんでした。Play Console で、表示されたアカウントを招待し、「アプリ情報の表示と一括レポートのダウンロード」の権限を付けたかを確かめてください（反映まで数分かかることがあります）。", status);
  }
  if (status === 404) return new StoreApiError("一括レポートの置き場所（pubsite_prod_rev_…）が見つかりませんでした。Play Console の「Cloud Storage の URI をコピー」の値を確かめてください。", status);
  return new StoreApiError(`Google Play の一括レポートを読めませんでした（${status}）。時間をおいて読み直します。`, status);
}

export async function listObjects(token: string, bucket: string, prefix: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const url = new URL(`${GCS}/b/${encodeURIComponent(bucket)}/o`);
  url.searchParams.set("prefix", prefix);
  url.searchParams.set("maxResults", "50");
  const { status, json } = await google<{ items?: { name?: string }[] }>(url.toString(), token, {}, fetchImpl);
  if (status >= 300) throw storageError(status);
  return (json.items ?? []).map((i) => i.name ?? "").filter(Boolean);
}

// ファイルを読む。ないとき（その月のレポートがまだない）は null
export async function downloadObject(token: string, bucket: string, name: string, fetchImpl: typeof fetch = fetch): Promise<Buffer | null> {
  const res = await fetchImpl(`${GCS}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw storageError(res.status);
  return Buffer.from(await res.arrayBuffer());
}

// Play Console の CSV は UTF-16（BOM つき）。UTF-8 でも読めるようにしておく
export function decodeCsv(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  return buf.toString("utf8");
}

// CSV（カンマ区切り、ダブルクォートで囲む値に対応）を、見出しの名前 → 値の行にする
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim()));
  if (!nonEmpty.length) return [];
  const head = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// 見出しの名前は大文字・小文字や表記の揺れがあるので、小文字にして比べる
function pick(row: Record<string, string>, ...names: string[]): string | undefined {
  const entries = Object.entries(row).map(([k, v]) => [k.toLowerCase(), v] as const);
  for (const n of names) {
    const hit = entries.find(([k]) => k === n.toLowerCase());
    if (hit) return hit[1];
  }
  return undefined;
}

const toNum = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export type PlayDay = { downloads: number; uninstalls: number; page_views: number; store_acquisitions: number };

// インストールの概要（installs_<package>_<YYYYMM>_overview.csv）と、ストアの掲載情報（store_performance_<package>_<YYYYMM>_country.csv）を、日ごとにまとめる
export function summarizePlay(installs: Record<string, string>[], storePerformance: Record<string, string>[]): Record<string, PlayDay> {
  const days: Record<string, PlayDay> = {};
  const day = (d: string) => (days[d] ??= { downloads: 0, uninstalls: 0, page_views: 0, store_acquisitions: 0 });
  for (const r of installs) {
    const d = pick(r, "Date");
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    day(d).downloads += toNum(pick(r, "Daily User Installs", "Install events"));
    day(d).uninstalls += toNum(pick(r, "Daily User Uninstalls", "Uninstall events"));
  }
  // 国ごとの行を足し合わせる
  for (const r of storePerformance) {
    const d = pick(r, "Date");
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    day(d).page_views += toNum(pick(r, "Store listing visitors"));
    day(d).store_acquisitions += toNum(pick(r, "Store listing acquisitions"));
  }
  return days;
}

export function installsObject(pkg: string, yyyymm: string): string {
  return `stats/installs/installs_${pkg}_${yyyymm}_overview.csv`;
}

export function storePerformanceObject(pkg: string, yyyymm: string): string {
  return `stats/store_performance/store_performance_${pkg}_${yyyymm}_country.csv`;
}

// Google Play の URL からパッケージ名（id=）を読む
export function packageFromUrl(url: string | null): string | null {
  try {
    return url ? new URL(url).searchParams.get("id") : null;
  } catch {
    return null;
  }
}

// プロジェクトの、矢書が作った利用者ごとのアカウント（yabumi- で始まり、管理用のアカウントは除く）
export async function listUserServiceAccounts(key: ManagerKey, token: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const emails: string[] = [];
  let pageToken = "";
  for (let i = 0; i < 20; i++) {
    const url = new URL(`https://iam.googleapis.com/v1/projects/${encodeURIComponent(key.project_id)}/serviceAccounts`);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const { status, json } = await google<{ accounts?: { email?: string }[]; nextPageToken?: string }>(url.toString(), token, {}, fetchImpl);
    if (status >= 300) throw new StoreApiError(`サービスアカウントの一覧を読めませんでした（${status}）`, status);
    for (const a of json.accounts ?? []) {
      if (a.email && /^yabumi-[a-z0-9]{14}@/.test(a.email) && a.email !== key.client_email) emails.push(a.email);
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return emails;
}
