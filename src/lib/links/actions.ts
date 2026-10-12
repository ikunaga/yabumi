"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { addLinkDomain, checkLinkDomain, defaultLinkDomainDeps, removeLinkDomain } from "./domains";
import { LinkError, createShortLink, isValidDestination } from "./store";

// 「短縮リンク」の画面の操作（docs/architecture.md の 4.22、決定 D20）。リンクの書き込みはサーバーだけが行う
// （行き先の形を確かめ、本人のプロジェクトにだけ作る）

export type LinkActionState = { error?: string; ok?: string };

async function ownProject(projectId: string) {
  if (!z.uuid().safeParse(projectId).success) return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  // RLS で本人のものしか読めない
  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  return project ? { userId, supabase } : null;
}

const snsSchema = z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]]);

const MAX_MANUAL_LINKS = 100;

export async function createLink(projectId: string, _prev: LinkActionState, formData: FormData): Promise<LinkActionState> {
  const owner = await ownProject(projectId);
  if (!owner) return { error: "ログインし直してください。" };
  const kind = formData.get("kind") === "profile" ? "profile" : "custom";
  const snsRaw = String(formData.get("sns") ?? "");
  const sns = snsRaw ? snsSchema.safeParse(snsRaw) : null;
  if (kind === "profile" && !sns?.success) return { error: "SNS を選んでください。" };
  if (sns && !sns.success) return { error: "SNS の選び方が正しくありません。" };
  const destination = String(formData.get("destination") ?? "").trim();
  if (!isValidDestination(destination)) return { error: "行き先は https:// で始まる URL にしてください（IP アドレスそのものや、矢書の URL は使えません）。" };
  const label = String(formData.get("label") ?? "").trim().slice(0, 100);

  const admin = createAdminClient();
  // 手で作るリンクの数の上限（悪用への備え。投稿のリンクは投稿の数で決まるので数えない）
  const { count } = await admin
    .from("short_links")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .in("kind", ["profile", "custom"])
    .is("disabled_at", null);
  if ((count ?? 0) >= MAX_MANUAL_LINKS) return { error: `手で作れるリンクは 1 つのプロジェクトに ${MAX_MANUAL_LINKS} 個までです。使っていないリンクを止めてください。` };
  if (kind === "profile") {
    // プロフィールのリンクは、SNS ごとに 1 つ（使っているものを止めてから作り直す）
    const { data: existing } = await admin
      .from("short_links")
      .select("id")
      .eq("project_id", projectId)
      .eq("kind", "profile")
      .eq("sns", sns!.data!)
      .is("disabled_at", null)
      .limit(1);
    if (existing?.length) return { error: "この SNS のプロフィールのリンクはもうあります。行き先を変えるときは、今のリンクを止めてから作ってください。" };
  }
  try {
    await createShortLink(admin, { ownerId: owner.userId, projectId, destinationUrl: destination, sns: sns?.data ?? null, kind, label });
  } catch (e) {
    if (e instanceof LinkError) return { error: e.userMessage };
    console.error("[createLink]", e);
    return { error: "リンクを作れませんでした。時間をおいてもう一度お試しください。" };
  }
  revalidatePath(`/projects/${projectId}/links`);
  return { ok: "リンクを作りました。" };
}

// リンクを止める・使い直す。止めたリンクを押すと「使われていません」と出る（送った投稿の中のリンクも止まる）
export async function setLinkDisabled(projectId: string, linkId: string, disabled: boolean): Promise<void> {
  if (!z.uuid().safeParse(linkId).success) return;
  const owner = await ownProject(projectId);
  if (!owner) return;
  await createAdminClient()
    .from("short_links")
    .update({ disabled_at: disabled ? new Date().toISOString() : null })
    .eq("id", linkId)
    .eq("project_id", projectId)
    .eq("owner_id", owner.userId);
  revalidatePath(`/projects/${projectId}/links`);
}

// App Store のキャンペーンリンクの provider token（pt）。数字だけ
export async function saveProviderToken(projectId: string, _prev: LinkActionState, formData: FormData): Promise<LinkActionState> {
  const owner = await ownProject(projectId);
  if (!owner) return { error: "ログインし直してください。" };
  const raw = String(formData.get("pt") ?? "").trim();
  if (raw && !/^[0-9]{1,20}$/.test(raw)) return { error: "pt は数字だけです（App Store Connect のキャンペーンリンクの pt= のあとの数字）。" };
  const { error } = await owner.supabase.from("projects").update({ app_store_provider_token: raw || null }).eq("id", projectId);
  if (error) return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  revalidatePath(`/projects/${projectId}/links`);
  return { ok: raw ? "保存しました。今から、短縮リンクで App Store に移る人に印（pt）を付けます。作ってあるリンクにも付くので、貼り直しは要りません。" : "pt を外しました。今から、短縮リンクで App Store に移る人に印（pt）を付けません。" };
}

// ===== 短縮リンクを自分のドメインで作る（F07、決定 D28。4.22） =====

export type LinkDomainActionState = { error?: string; suggestion?: string; ok?: string };

export async function addLinkDomainAction(projectId: string, _prev: LinkDomainActionState, formData: FormData): Promise<LinkDomainActionState> {
  const owner = await ownProject(projectId);
  if (!owner) return { error: "ログインし直してください。" };
  try {
    const r = await addLinkDomain(createAdminClient(), { ownerId: owner.userId, projectId, domain: String(formData.get("domain") ?? "") }, defaultLinkDomainDeps());
    if (!r.ok) return { error: r.error, suggestion: r.suggestion };
  } catch (e) {
    console.error("[addLinkDomain]", e instanceof Error ? e.message : e);
    return { error: "いまドメインを足せませんでした。時間をおいてもう一度お試しください。" };
  }
  revalidatePath(`/projects/${projectId}/links`);
  return { ok: "ドメインを受け付けました。次に、DNS に 1 行足してください。" };
}

export async function checkLinkDomainAction(projectId: string): Promise<LinkDomainActionState> {
  const owner = await ownProject(projectId);
  if (!owner) return { error: "ログインし直してください。" };
  try {
    const r = await checkLinkDomain(createAdminClient(), { ownerId: owner.userId, projectId }, defaultLinkDomainDeps());
    if (!r.ok) return { error: r.error };
  } catch (e) {
    console.error("[checkLinkDomain]", e instanceof Error ? e.message : e);
    return { error: "いま確かめられませんでした。時間をおいてもう一度お試しください。" };
  }
  revalidatePath(`/projects/${projectId}/links`);
  return {};
}

export async function removeLinkDomainAction(projectId: string): Promise<LinkDomainActionState> {
  const owner = await ownProject(projectId);
  if (!owner) return { error: "ログインし直してください。" };
  try {
    await removeLinkDomain(createAdminClient(), { ownerId: owner.userId, projectId }, defaultLinkDomainDeps());
  } catch (e) {
    console.error("[removeLinkDomain]", e instanceof Error ? e.message : e);
    return { error: "いま外せませんでした。時間をおいてもう一度お試しください。" };
  }
  revalidatePath(`/projects/${projectId}/links`);
  return { ok: "外しました。これからの短縮リンクは、矢書のドメインで作ります。" };
}
