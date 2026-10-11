import type { SupabaseClient } from "@supabase/supabase-js";
import { credentialKeysFromEnv, openCredential, sealCredential, type CredentialKeys } from "@/lib/crypto/credential-cipher";
import type { Database, Json } from "@/lib/supabase/database.types";
import { appleIdFromUrl, fetchDailySales, pacificDate, StoreApiError, summarizeSales, type AscCredential } from "./app-store";
import { fetchOverview, type RevenueCatCredential } from "./revenuecat";

// 預かる鍵の保存・読み出しと、日ごとの取り込み（docs/architecture.md の 4.22）。admin は RLS を通らないクライアント。
// 呼ぶ側で、ownerId がログイン中の利用者で、projectId がその人のものであることを確かめておく

type Admin = SupabaseClient<Database>;
export type Provider = "app_store_connect" | "revenuecat";
type SecretOf<P extends Provider> = P extends "app_store_connect" ? AscCredential : RevenueCatCredential;

export type StoreDeps = { fetch?: typeof fetch; now?: () => Date; keys?: CredentialKeys };

const aad = (id: string, provider: Provider) => `${id}:${provider}`;

// 鍵を保存する（同じプロジェクト・取り込み元の古い鍵は消して入れ替える）。保存の前に使えるかを確かめておく（verifyCredential）
export async function saveCredential<P extends Provider>(
  admin: Admin,
  input: { ownerId: string; projectId: string; provider: P; secret: SecretOf<P>; hint: string },
  deps: StoreDeps = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const sealed = sealCredential(JSON.stringify(input.secret), aad(id, input.provider), deps.keys ?? credentialKeysFromEnv());
  const { error: delError } = await admin.from("store_credentials").delete().eq("project_id", input.projectId).eq("provider", input.provider).eq("owner_id", input.ownerId);
  if (delError) throw delError;
  const { error } = await admin.from("store_credentials").insert({
    id,
    owner_id: input.ownerId,
    project_id: input.projectId,
    provider: input.provider,
    secret_sealed: sealed,
    hint: input.hint.slice(0, 100),
    status: "ok",
    last_checked_at: (deps.now?.() ?? new Date()).toISOString(),
  });
  if (error) throw error;
  return id;
}

type CredentialRow = Database["public"]["Tables"]["store_credentials"]["Row"];

// 鍵を開く。古い鍵（CREDENTIAL_ENCRYPTION_KEYS_OLD）で暗号化していたら、新しい鍵で暗号化し直して保存する
export async function openStoredCredential<P extends Provider>(admin: Admin, row: CredentialRow & { provider: P }, deps: StoreDeps = {}): Promise<SecretOf<P>> {
  const keys = deps.keys ?? credentialKeysFromEnv();
  const { plain, needsReseal } = openCredential(row.secret_sealed, aad(row.id, row.provider), keys);
  if (needsReseal) {
    const { error } = await admin.from("store_credentials").update({ secret_sealed: sealCredential(plain, aad(row.id, row.provider), keys) }).eq("id", row.id);
    if (error) console.error("[stores] 鍵を暗号化し直せませんでした", error.message);
  }
  return JSON.parse(plain) as SecretOf<P>;
}

export async function removeCredential(admin: Admin, ownerId: string, projectId: string, provider: Provider): Promise<void> {
  const { error } = await admin.from("store_credentials").delete().eq("owner_id", ownerId).eq("project_id", projectId).eq("provider", provider);
  if (error) throw error;
}

// 保存する前に、1 回呼んで使えるかを確かめる。だめなら StoreApiError（利用者向けの説明つき）
export async function verifyCredential<P extends Provider>(provider: P, secret: SecretOf<P>, deps: StoreDeps = {}): Promise<string> {
  const now = deps.now?.() ?? new Date();
  if (provider === "app_store_connect") {
    // 2 日前（太平洋時間）のレポート。売上やダウンロードがなくても（404）、鍵とベンダー番号が正しければ使える
    const rows = await fetchDailySales(secret as AscCredential, pacificDate(now, 2), deps.fetch, now);
    return rows ? `使えました（${pacificDate(now, 2)} のレポートを読めました）` : `使えました（${pacificDate(now, 2)} は売上・ダウンロードがありませんでした）`;
  }
  const values = await fetchOverview(secret as RevenueCatCredential, "JPY", deps.fetch);
  return `使えました（${Object.keys(values).length} 個の数字を読めました）`;
}

async function upsertDaily(admin: Admin, row: { projectId: string; ownerId: string; source: "app_store" | "revenuecat"; day: string; values: Json }) {
  const { error } = await admin
    .from("store_daily")
    .upsert({ project_id: row.projectId, owner_id: row.ownerId, source: row.source, day: row.day, values: row.values }, { onConflict: "project_id,source,day" });
  if (error) throw error;
}

// 最初に取り込む日数と、1 回の取り込みで読む日数の上限
export const FIRST_IMPORT_DAYS = 14;
export const MAX_DAYS_PER_RUN = 7;

export type ImportOutcome = { credentialId: string; provider: Provider; result: "imported" | "skipped" | "failed"; days?: number; message?: string };

// 1 つの鍵で取り込む。App Store は、取り込んだ日の次の日から、太平洋時間の昨日までを、1 回に MAX_DAYS_PER_RUN 日まで。
// RevenueCat は、今日（日本時間）の概要を 1 回
export async function importForCredential(admin: Admin, row: CredentialRow, deps: StoreDeps = {}): Promise<ImportOutcome> {
  const now = deps.now?.() ?? new Date();
  const provider = row.provider as Provider;
  const base = { credentialId: row.id, provider };
  // 取り込むものがなかったときも、確かめた日時を進める（毎日のジョブで、古い順に読むため）
  const skipped = async () => {
    await admin.from("store_credentials").update({ last_checked_at: now.toISOString() }).eq("id", row.id);
    return { ...base, result: "skipped" as const };
  };
  const markFailed = async (message: string) => {
    await admin.from("store_credentials").update({ status: "error", last_error: message, last_checked_at: now.toISOString() }).eq("id", row.id);
    return { ...base, result: "failed" as const, message };
  };
  try {
    if (provider === "app_store_connect") {
      const cred = await openStoredCredential(admin, row as CredentialRow & { provider: "app_store_connect" }, deps);
      const { data: project } = await admin.from("projects").select("app_store_url").eq("id", row.project_id).single();
      const appleId = appleIdFromUrl(project?.app_store_url ?? null);
      const yesterday = pacificDate(now, 1);
      const days: string[] = [];
      for (let i = FIRST_IMPORT_DAYS; i >= 1; i--) {
        const d = pacificDate(now, i);
        if ((!row.last_imported_day || d > row.last_imported_day) && d <= yesterday) days.push(d);
      }
      if (!days.length) return skipped();
      const batch = days.slice(0, MAX_DAYS_PER_RUN);
      for (const day of batch) {
        const rows = await fetchDailySales(cred, day, deps.fetch, now);
        const summary = rows ? summarizeSales(rows, appleId) : { downloads: 0, redownloads: 0, updates: 0, iap_units: 0, proceeds: {} };
        await upsertDaily(admin, { projectId: row.project_id, ownerId: row.owner_id, source: "app_store", day, values: summary as unknown as Json });
      }
      await admin
        .from("store_credentials")
        .update({ status: "ok", last_error: null, last_checked_at: now.toISOString(), last_imported_day: batch[batch.length - 1] })
        .eq("id", row.id);
      return { ...base, result: "imported", days: batch.length };
    }

    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
    if (row.last_imported_day && row.last_imported_day >= today) return skipped();
    const cred = await openStoredCredential(admin, row as CredentialRow & { provider: "revenuecat" }, deps);
    const values = await fetchOverview(cred, "JPY", deps.fetch);
    await upsertDaily(admin, { projectId: row.project_id, ownerId: row.owner_id, source: "revenuecat", day: today, values: { ...values, currency: "JPY" } });
    await admin.from("store_credentials").update({ status: "ok", last_error: null, last_checked_at: now.toISOString(), last_imported_day: today }).eq("id", row.id);
    return { ...base, result: "imported", days: 1 };
  } catch (e) {
    if (e instanceof StoreApiError) return markFailed(e.userMessage);
    console.error("[stores] 取り込みに失敗しました", e instanceof Error ? e.message : e);
    return markFailed("取り込みに失敗しました。時間をおいて読み直します。");
  }
}

// 毎日のジョブ: 取り込みが済んでいない鍵を、古い順に limit 個まで。ownerId を渡すとその利用者の分だけ（結合テスト用）
// deadlineMs: この時刻（ms）を過ぎたら、新しい鍵には手をつけない（Vercel の 60 秒に収める。残りは次の回）
export async function runStoreImports(admin: Admin, deps: StoreDeps & { limit?: number; ownerId?: string; deadlineMs?: number } = {}): Promise<ImportOutcome[]> {
  let q = admin.from("store_credentials").select("*").order("last_checked_at", { ascending: true, nullsFirst: true }).limit(deps.limit ?? 20);
  if (deps.ownerId) q = q.eq("owner_id", deps.ownerId);
  const { data, error } = await q;
  if (error) throw error;
  const outcomes: ImportOutcome[] = [];
  for (const row of data ?? []) {
    if (deps.deadlineMs && Date.now() > deps.deadlineMs) break;
    outcomes.push(await importForCredential(admin, row, deps));
  }
  return outcomes;
}

export type CredentialStatus = { provider: Provider; hint: string; status: "ok" | "error"; lastError: string | null; lastCheckedAt: string | null; lastImportedDay: string | null };

// 画面に出す状態（鍵の中身は返さない）
export async function credentialStatuses(admin: Admin, ownerId: string, projectId: string): Promise<Partial<Record<Provider, CredentialStatus>>> {
  const { data, error } = await admin
    .from("store_credentials")
    .select("provider, hint, status, last_error, last_checked_at, last_imported_day")
    .eq("owner_id", ownerId)
    .eq("project_id", projectId);
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map((r) => [
      r.provider,
      { provider: r.provider as Provider, hint: r.hint, status: r.status as "ok" | "error", lastError: r.last_error, lastCheckedAt: r.last_checked_at, lastImportedDay: r.last_imported_day },
    ]),
  );
}
