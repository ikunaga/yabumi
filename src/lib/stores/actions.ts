"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { credentialsConfigured } from "@/lib/crypto/credential-cipher";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkAscFormat, StoreApiError } from "./app-store";
import { checkRevenueCatFormat } from "./revenuecat";
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
