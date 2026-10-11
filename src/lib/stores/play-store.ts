import type { SupabaseClient } from "@supabase/supabase-js";
import type { CredentialKeys } from "@/lib/crypto/credential-cipher";
import type { Database, Json } from "@/lib/supabase/database.types";
import { appleIdFromUrl, StoreApiError, type AscCredential } from "./app-store";
import { ensureOngoingRequest, listDailyInstances, readInstance } from "./app-store-analytics";
import {
  createServiceAccount,
  decodeCsv,
  deleteServiceAccount,
  downloadObject,
  impersonate,
  installsObject,
  listObjects,
  listUserServiceAccounts,
  managerAccessToken,
  managerKeyFromEnv,
  newAccountId,
  parseCsv,
  storePerformanceObject,
  summarizePlay,
  type ManagerKey,
} from "./google";
import { openStoredCredential } from "./store";

// Google Play の取り込みと、App Store のストアのページの閲覧数（docs/architecture.md の 4.22、段取り ⑤）。admin は RLS を通らないクライアント。
// 呼ぶ側で、ownerId がログイン中の利用者で、projectId がその人のものであることを確かめておく

type Admin = SupabaseClient<Database>;
export type GoogleDeps = { managerKey?: ManagerKey | null; fetch?: typeof fetch; now?: () => Date; keys?: CredentialKeys };

function requireKey(deps: GoogleDeps): ManagerKey {
  const key = deps.managerKey === undefined ? managerKeyFromEnv() : deps.managerKey;
  if (!key) throw new StoreApiError("Google Play の取り込みは準備中です（運営者の設定がまだです）。", 503);
  return key;
}

// ===== Google Play =====

// この利用者・プロジェクト専用のサービスアカウントを用意する（あれば使い回す）。利用者は返ったメールアドレスを Play Console に招待する
export async function startPlayConnection(admin: Admin, ownerId: string, projectId: string, deps: GoogleDeps = {}): Promise<string> {
  const { data: existing } = await admin.from("play_connections").select("service_account_email").eq("project_id", projectId).eq("owner_id", ownerId).maybeSingle();
  if (existing) return existing.service_account_email;
  const key = requireKey(deps);
  const token = await managerAccessToken(key, deps.fetch, deps.now?.());
  // メールアドレスは ID とプロジェクトで決まるので、先に記録してから Google の側に作る（記録のないアカウントを消す片付けと重ならないように）
  const accountId = newAccountId();
  const email = `${accountId}@${key.project_id}.iam.gserviceaccount.com`;
  const { error } = await admin.from("play_connections").insert({ project_id: projectId, owner_id: ownerId, service_account_email: email });
  if (error) {
    // 1 人がつなげる数・1 日に作れる数の上限（DB のトリガー。Google Cloud のアカウントの数をほかの人の分まで使わないように）
    if (error.message.includes("play_connection_limit")) throw new StoreApiError("Google Play をつなげるのは 3 つのプロジェクトまでです。使っていないプロジェクトの Google Play を外してください。", 429);
    if (error.message.includes("play_connection_rate")) throw new StoreApiError("Google Play のつなぎ直しが続いています。明日もう一度お試しください。", 429);
    // 同時に 2 回押されたなど。先に入った方を使う
    const { data: again } = await admin.from("play_connections").select("service_account_email").eq("project_id", projectId).eq("owner_id", ownerId).maybeSingle();
    if (again) return again.service_account_email;
    throw error;
  }
  try {
    const created = await createServiceAccount(key, token, accountId, `yabumi ${projectId.slice(0, 8)}`, deps.fetch);
    if (created !== email) throw new Error(`作ったアカウントのメールアドレスが想定と違います（${created}）`);
  } catch (e) {
    await admin.from("play_connections").delete().eq("project_id", projectId).eq("owner_id", ownerId);
    throw e;
  }
  return email;
}

type PlayRow = Database["public"]["Tables"]["play_connections"]["Row"];

async function playToken(row: Pick<PlayRow, "service_account_email">, deps: GoogleDeps): Promise<string> {
  const key = requireKey(deps);
  const manager = await managerAccessToken(key, deps.fetch, deps.now?.());
  return impersonate(manager, row.service_account_email, deps.fetch);
}

// 招待と入力のあとに確かめる。読めたら保存して、すぐ取り込む
export async function verifyPlay(admin: Admin, ownerId: string, projectId: string, bucket: string, pkg: string, deps: GoogleDeps = {}): Promise<string> {
  const { data: row } = await admin.from("play_connections").select("*").eq("project_id", projectId).eq("owner_id", ownerId).maybeSingle();
  if (!row) throw new StoreApiError("先に「Google Play をつなぐ」を押してください。", 400);
  const token = await playToken(row, deps);
  const files = await listObjects(token, bucket, `stats/installs/installs_${pkg}_`, deps.fetch);
  const now = deps.now?.() ?? new Date();
  const { error } = await admin
    .from("play_connections")
    .update({ bucket, package_name: pkg, status: "ok", last_error: null, last_checked_at: now.toISOString() })
    .eq("project_id", projectId);
  if (error) throw error;
  await importPlay(admin, { ...row, bucket, package_name: pkg }, deps).catch((e) => console.error("[play] 最初の取り込みに失敗しました", e instanceof Error ? e.message : e));
  return files.length
    ? `読めました（${files.length} か月分のインストールのレポートがあります）`
    : "読めました（まだレポートがありません。新しいアプリや招待した直後は、数日かかります）";
}

function months(now: Date): string[] {
  const ym = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  return [ym(prev), ym(now)];
}

export type PlayOutcome = { projectId: string; result: "imported" | "skipped" | "failed"; days?: number; message?: string };

// 今月と先月のファイルを読み、直近 60 日の日ごとの数字を上書きする（Play のレポートは 3〜7 日遅れ、あとから直るので毎日読み直す）
export async function importPlay(admin: Admin, row: PlayRow, deps: GoogleDeps = {}): Promise<PlayOutcome> {
  const now = deps.now?.() ?? new Date();
  if (!row.bucket || !row.package_name) return { projectId: row.project_id, result: "skipped" };
  try {
    const token = await playToken(row, deps);
    const installs: Record<string, string>[] = [];
    const perf: Record<string, string>[] = [];
    for (const m of months(now)) {
      const a = await downloadObject(token, row.bucket, installsObject(row.package_name, m), deps.fetch);
      if (a) installs.push(...parseCsv(decodeCsv(a)));
      const b = await downloadObject(token, row.bucket, storePerformanceObject(row.package_name, m), deps.fetch);
      if (b) perf.push(...parseCsv(decodeCsv(b)));
    }
    const since = new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
    const days = Object.entries(summarizePlay(installs, perf)).filter(([d]) => d >= since);
    if (days.length) {
      const { error } = await admin.from("store_daily").upsert(
        days.map(([day, values]) => ({ project_id: row.project_id, owner_id: row.owner_id, source: "google_play", day, values: values as unknown as Json })),
        { onConflict: "project_id,source,day" },
      );
      if (error) throw error;
    }
    await admin.from("play_connections").update({ status: "ok", last_error: null, last_checked_at: now.toISOString() }).eq("project_id", row.project_id);
    return { projectId: row.project_id, result: "imported", days: days.length };
  } catch (e) {
    const message = e instanceof StoreApiError ? e.userMessage : "取り込みに失敗しました。時間をおいて読み直します。";
    if (!(e instanceof StoreApiError)) console.error("[play] 取り込みに失敗しました", e instanceof Error ? e.message : e);
    await admin.from("play_connections").update({ status: "error", last_error: message, last_checked_at: now.toISOString() }).eq("project_id", row.project_id);
    return { projectId: row.project_id, result: "failed", message };
  }
}

// 外す: 矢書の側のサービスアカウントを消し（Play Console の招待も効かなくなる）、つなぎを消す。取り込んだ数字は残る
export async function removePlay(admin: Admin, ownerId: string, projectId: string, deps: GoogleDeps = {}): Promise<void> {
  const { data: row } = await admin.from("play_connections").select("service_account_email").eq("project_id", projectId).eq("owner_id", ownerId).maybeSingle();
  if (!row) return;
  try {
    const key = requireKey(deps);
    await deleteServiceAccount(await managerAccessToken(key, deps.fetch, deps.now?.()), row.service_account_email, deps.fetch);
  } catch (e) {
    // 消せなくても、つなぎは消す（アカウントは鍵がなく、矢書からしか使えない）
    console.error("[play] サービスアカウントを消せませんでした", e instanceof Error ? e.message : e);
  }
  await admin.from("play_connections").delete().eq("project_id", projectId).eq("owner_id", ownerId);
}

// ===== App Store のストアのページの閲覧数 =====

// Admin のキーで依頼を作る（キーは保存しない）
export async function startAppStoreViews(admin: Admin, ownerId: string, projectId: string, adminCred: AscCredential, deps: GoogleDeps = {}): Promise<void> {
  const { data: project } = await admin.from("projects").select("app_store_url").eq("id", projectId).eq("owner_id", ownerId).maybeSingle();
  const appleId = appleIdFromUrl(project?.app_store_url ?? null);
  if (!appleId) throw new StoreApiError("プロジェクトに App Store の URL（id の数字が入ったもの）を入れてください。", 400);
  const requestId = await ensureOngoingRequest(adminCred, appleId, deps.fetch, deps.now?.());
  const { error } = await admin
    .from("app_store_report_requests")
    .upsert({ project_id: projectId, owner_id: ownerId, request_id: requestId, app_apple_id: appleId, status: "ok", last_error: null });
  if (error) throw error;
}

type ViewsRow = Database["public"]["Tables"]["app_store_report_requests"]["Row"];

// 預かっている Sales and Reports のキーで、まだ読んでいない日ごとの回を 1 回に 5 つまで読む
export async function importAppStoreViews(admin: Admin, row: ViewsRow, deps: GoogleDeps = {}): Promise<PlayOutcome> {
  const now = deps.now?.() ?? new Date();
  try {
    const { data: credRow } = await admin.from("store_credentials").select("*").eq("project_id", row.project_id).eq("provider", "app_store_connect").maybeSingle();
    if (!credRow) throw new StoreApiError("App Store の売上の鍵（Sales and Reports）を先に入れてください。", 400);
    const cred = await openStoredCredential(admin, credRow as typeof credRow & { provider: "app_store_connect" }, { keys: deps.keys, now: deps.now });
    const instances = (await listDailyInstances(cred, row.request_id, row.last_imported_day, deps.fetch, now)).slice(0, 5);
    let last = row.last_imported_day;
    for (const inst of instances) {
      const days = Object.entries(await readInstance(cred, inst.id, deps.fetch, now));
      if (days.length) {
        const { error } = await admin.from("store_daily").upsert(
          days.map(([day, values]) => ({ project_id: row.project_id, owner_id: row.owner_id, source: "app_store_views", day, values: values as unknown as Json })),
          { onConflict: "project_id,source,day" },
        );
        if (error) throw error;
      }
      last = inst.processingDate;
    }
    await admin
      .from("app_store_report_requests")
      .update({ status: "ok", last_error: null, last_checked_at: now.toISOString(), last_imported_day: last })
      .eq("project_id", row.project_id);
    return { projectId: row.project_id, result: instances.length ? "imported" : "skipped", days: instances.length };
  } catch (e) {
    const message = e instanceof StoreApiError ? e.userMessage : "取り込みに失敗しました。時間をおいて読み直します。";
    if (!(e instanceof StoreApiError)) console.error("[app-store-views] 取り込みに失敗しました", e instanceof Error ? e.message : e);
    await admin.from("app_store_report_requests").update({ status: "error", last_error: message, last_checked_at: now.toISOString() }).eq("project_id", row.project_id);
    return { projectId: row.project_id, result: "failed", message };
  }
}

export async function removeAppStoreViews(admin: Admin, ownerId: string, projectId: string): Promise<void> {
  await admin.from("app_store_report_requests").delete().eq("project_id", projectId).eq("owner_id", ownerId);
}

// 記録のない利用者ごとのアカウントを Google の側で消す（退会やプロジェクトの削除で記録だけが消えたもの）。
// つないだ直後の記録の書き込みと重ならないよう、記録のないアカウントは作られて 1 時間以上たったものだけ…ではなく、
// 作成の時刻が一覧に出ないので、2 回続けて（前の日も）記録がなかったものだけを消す
export async function cleanupOrphanServiceAccounts(admin: Admin, deps: GoogleDeps & { seenBefore?: Set<string> } = {}): Promise<string[]> {
  const key = requireKey(deps);
  const token = await managerAccessToken(key, deps.fetch, deps.now?.());
  const all = await listUserServiceAccounts(key, token, deps.fetch);
  if (!all.length) return [];
  const { data, error } = await admin.from("play_connections").select("service_account_email").in("service_account_email", all);
  if (error) throw error;
  const known = new Set((data ?? []).map((r) => r.service_account_email));
  const removed: string[] = [];
  for (const email of all.filter((e) => !known.has(e))) {
    await deleteServiceAccount(token, email, deps.fetch).catch((e) => console.error("[play] 記録のないアカウントを消せませんでした", e instanceof Error ? e.message : e));
    removed.push(email);
  }
  return removed;
}

// 毎日のジョブ（import-stores から）。ownerId を渡すとその利用者の分だけ（結合テスト用）
export async function runPlayAndViewsImports(admin: Admin, deps: GoogleDeps & { ownerId?: string; limit?: number; deadlineMs?: number } = {}): Promise<PlayOutcome[]> {
  const outcomes: PlayOutcome[] = [];
  const late = () => Boolean(deps.deadlineMs && Date.now() > deps.deadlineMs);
  let pq = admin.from("play_connections").select("*").not("bucket", "is", null).order("last_checked_at", { ascending: true, nullsFirst: true }).limit(deps.limit ?? 20);
  if (deps.ownerId) pq = pq.eq("owner_id", deps.ownerId);
  const { data: plays } = await pq;
  for (const row of plays ?? []) {
    if (late()) break;
    outcomes.push(await importPlay(admin, row, deps));
  }
  let vq = admin.from("app_store_report_requests").select("*").order("last_checked_at", { ascending: true, nullsFirst: true }).limit(deps.limit ?? 20);
  if (deps.ownerId) vq = vq.eq("owner_id", deps.ownerId);
  const { data: views } = await vq;
  for (const row of views ?? []) {
    if (late()) break;
    outcomes.push(await importAppStoreViews(admin, row, deps));
  }
  return outcomes;
}
