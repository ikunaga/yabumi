"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { credentialsConfigured } from "@/lib/crypto/credential-cipher";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkAscFormat, StoreApiError } from "./app-store";
import { checkRevenueCatFormat } from "./revenuecat";
import { checkPlayCapacity, removeAppStoreViews, removePlay, startAppStoreViews, startPlayConnection, verifyPlay } from "./play-store";
import { importForCredential, removeCredential, saveCredential, verifyCredential, type Provider } from "./store";

// 「ストアと課金をつなぐ」の操作（docs/architecture.md の 4.22）。入れた鍵は、保存の前に 1 回呼んで使えるかを確かめる

export type StoreFormState = { error?: string; ok?: string };

async function ownProject(projectId: string) {
  if (!z.uuid().safeParse(projectId).success) return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  return project ? userId : null;
}

const NOT_READY = "ストアと課金の取り込みは準備中です（運営者の設定がまだです）。";

async function verifySaveImport(projectId: string, userId: string, provider: Provider, secret: never, hint: string): Promise<StoreFormState> {
  let verified: string;
  try {
    verified = await verifyCredential(provider, secret);
  } catch (e) {
    if (e instanceof StoreApiError) return { error: e.userMessage };
    console.error("[stores] 確かめられませんでした", e instanceof Error ? e.message : e);
    return { error: "確かめられませんでした。時間をおいてもう一度お試しください。" };
  }
  const admin = createAdminClient();
  const id = await saveCredential(admin, { ownerId: userId, projectId, provider, secret, hint });
  // 最初の取り込み（App Store は直近の数日分。残りは毎日のジョブ）。失敗しても保存はできている
  const { data: row } = await admin.from("store_credentials").select("*").eq("id", id).single();
  if (row) await importForCredential(admin, row).catch((e) => console.error("[stores] 最初の取り込みに失敗しました", e instanceof Error ? e.message : e));
  revalidatePath(`/projects/${projectId}/stores`);
  revalidatePath(`/projects/${projectId}/metrics`);
  return { ok: `${verified}。保存しました。これから毎日、自動で取り込みます。` };
}

export async function saveAppStoreConnect(projectId: string, _prev: StoreFormState, formData: FormData): Promise<StoreFormState> {
  const userId = await ownProject(projectId);
  if (!userId) return { error: "ログインし直してください。" };
  if (!credentialsConfigured()) return { error: NOT_READY };
  const secret = {
    issuerId: String(formData.get("issuerId") ?? "").trim(),
    keyId: String(formData.get("keyId") ?? "").trim().toUpperCase(),
    privateKey: String(formData.get("privateKey") ?? "").trim(),
    vendorNumber: String(formData.get("vendorNumber") ?? "").trim(),
  };
  const formatError = checkAscFormat(secret);
  if (formatError) return { error: formatError };
  return verifySaveImport(projectId, userId, "app_store_connect", secret as never, `Key ID …${secret.keyId.slice(-4)}・ベンダー番号 ${secret.vendorNumber}`);
}

export async function saveRevenueCat(projectId: string, _prev: StoreFormState, formData: FormData): Promise<StoreFormState> {
  const userId = await ownProject(projectId);
  if (!userId) return { error: "ログインし直してください。" };
  if (!credentialsConfigured()) return { error: NOT_READY };
  const secret = { projectId: String(formData.get("rcProjectId") ?? "").trim(), secretKey: String(formData.get("secretKey") ?? "").trim() };
  const formatError = checkRevenueCatFormat(secret);
  if (formatError) return { error: formatError };
  return verifySaveImport(projectId, userId, "revenuecat", secret as never, `プロジェクト ${secret.projectId}・キー …${secret.secretKey.slice(-4)}`);
}

// 外す: 預かった鍵を消す（取り込んだ数字は残る。プロジェクトを消すか退会すると消える）
export async function removeStoreCredential(projectId: string, provider: Provider): Promise<void> {
  if (provider !== "app_store_connect" && provider !== "revenuecat") return;
  const userId = await ownProject(projectId);
  if (!userId) return;
  await removeCredential(createAdminClient(), userId, projectId, provider);
  revalidatePath(`/projects/${projectId}/stores`);
}

// ===== Google Play（段取り ⑤） =====

// 矢書の側に、この利用者・プロジェクト専用の読み取り用のアカウントを作る（利用者は表示されたメールアドレスを Play Console に招待する）
export async function startGooglePlay(projectId: string): Promise<StoreFormState> {
  const userId = await ownProject(projectId);
  if (!userId) return { error: "ログインし直してください。" };
  // 作ったあと（上限で断られたときも）、全員の作成数を数え、しきい値に達していれば運営者に知らせる（返事は待たせない）
  after(() => checkPlayCapacity(createAdminClient()).catch((e) => console.error("[stores] 作成数を確かめられませんでした", e instanceof Error ? e.message : e)));
  try {
    await startPlayConnection(createAdminClient(), userId, projectId);
  } catch (e) {
    if (e instanceof StoreApiError) return { error: e.userMessage };
    console.error("[stores] Google Play のアカウントを作れませんでした", e instanceof Error ? e.message : e);
    return { error: "Google Play 用のアカウントを作れませんでした。時間をおいてもう一度お試しください。" };
  }
  revalidatePath(`/projects/${projectId}/stores`);
  return {};
}

export async function saveGooglePlay(projectId: string, _prev: StoreFormState, formData: FormData): Promise<StoreFormState> {
  const userId = await ownProject(projectId);
  if (!userId) return { error: "ログインし直してください。" };
  // 「gs://pubsite_prod_rev_…」で貼っても、バケットの名前だけにする
  const bucket = String(formData.get("bucket") ?? "").trim().replace(/^gs:\/\//, "").replace(/\/.*$/, "");
  const pkg = String(formData.get("package") ?? "").trim();
  if (!/^pubsite_prod_[a-z0-9_]{3,60}$/.test(bucket)) return { error: "一括レポートの置き場所は pubsite_prod_ で始まる名前です（Play Console の「Cloud Storage の URI をコピー」）。" };
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(pkg)) return { error: "パッケージ名の形が違います（例: com.example.kakeibo）。" };
  try {
    const verified = await verifyPlay(createAdminClient(), userId, projectId, bucket, pkg);
    revalidatePath(`/projects/${projectId}/stores`);
    revalidatePath(`/projects/${projectId}/metrics`);
    return { ok: `${verified}。これから毎日、自動で取り込みます。` };
  } catch (e) {
    if (e instanceof StoreApiError) return { error: e.userMessage };
    console.error("[stores] Google Play を確かめられませんでした", e instanceof Error ? e.message : e);
    return { error: "確かめられませんでした。時間をおいてもう一度お試しください。" };
  }
}

export async function removeGooglePlay(projectId: string): Promise<void> {
  const userId = await ownProject(projectId);
  if (!userId) return;
  await removePlay(createAdminClient(), userId, projectId);
  revalidatePath(`/projects/${projectId}/stores`);
}

// ===== App Store のストアのページの閲覧数（段取り ⑤） =====

// Admin のキーで、続けて作られるレポートの依頼を作る。キーは保存しない（この 1 回だけ使う）
export async function startAppStorePageViews(projectId: string, _prev: StoreFormState, formData: FormData): Promise<StoreFormState> {
  const userId = await ownProject(projectId);
  if (!userId) return { error: "ログインし直してください。" };
  const adminCred = {
    issuerId: String(formData.get("issuerId") ?? "").trim(),
    keyId: String(formData.get("keyId") ?? "").trim().toUpperCase(),
    privateKey: String(formData.get("privateKey") ?? "").trim(),
    vendorNumber: "000000",
  };
  const formatError = checkAscFormat(adminCred);
  if (formatError) return { error: formatError };
  try {
    await startAppStoreViews(createAdminClient(), userId, projectId, adminCred);
  } catch (e) {
    if (e instanceof StoreApiError) return { error: e.userMessage };
    console.error("[stores] レポートの依頼を作れませんでした", e instanceof Error ? e.message : e);
    return { error: "レポートの依頼を作れませんでした。時間をおいてもう一度お試しください。" };
  }
  revalidatePath(`/projects/${projectId}/stores`);
  return { ok: "レポートの依頼を作りました（Admin のキーは保存していません）。Apple がレポートを作り始めるまで 1〜2 日かかり、そのあと毎日取り込みます。" };
}

export async function removeAppStorePageViews(projectId: string): Promise<void> {
  const userId = await ownProject(projectId);
  if (!userId) return;
  await removeAppStoreViews(createAdminClient(), userId, projectId);
  revalidatePath(`/projects/${projectId}/stores`);
}
