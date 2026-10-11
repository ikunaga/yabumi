"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { LinkError, createShortLink, isValidDestination } from "./store";

// 「リンク」の画面の操作（docs/architecture.md の 4.22、決定 D20）。リンクの書き込みはサーバーだけが行う
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

export async function createLink(projectId: string, _prev: LinkActionState, formData: FormData): Promise<LinkActionState> {
  const owner = await ownProject(projectId);
  if (!owner) return { error: "ログインし直してください。" };
  const kind = formData.get("kind") === "profile" ? "profile" : "custom";
  const snsRaw = String(formData.get("sns") ?? "");
  const sns = snsRaw ? snsSchema.safeParse(snsRaw) : null;
  if (kind === "profile" && !sns?.success) return { error: "SNS を選んでください。" };
  if (sns && !sns.success) return { error: "SNS の選び方が正しくありません。" };
  const destination = String(formData.get("destination") ?? "").trim();
  if (!isValidDestination(destination)) return { error: "行き先は https:// で始まる URL にしてください。" };
  const label = String(formData.get("label") ?? "").trim().slice(0, 100);

  const admin = createAdminClient();
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
  return { ok: raw ? "保存しました。これから App Store へのリンクに pt を付けます。" : "pt を外しました。" };
}
