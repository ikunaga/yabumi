"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ISSUE_LABEL, SNS, checkTarget, type SnsKey } from "@/lib/sns";
import { adapters, canPublish } from "@/lib/sns/adapters";
import { publishDueTargets } from "@/lib/sns/publisher";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fromInputValue, toYmd } from "@/lib/time";
import { connectedAccounts } from "./queries";
import { savePostInputSchema, type SavePostInput, type SavePostResult } from "./schema";

// 予約は少なくとも 5 分後から（送信ジョブの間隔より余裕を持たせる）
const MIN_LEAD_MS = 5 * 60 * 1000;

export async function savePost(input: SavePostInput): Promise<SavePostResult> {
  const parsed = savePostInputSchema.safeParse(input);
  if (!parsed.success) return { error: "入力の形式が正しくありません。画面を読み込み直してください。" };
  const { projectId, postId, body, targets, plannedAt, intent } = parsed.data;

  const fieldErrors: NonNullable<SavePostResult["fieldErrors"]> = {};
  if (body.trim() === "") fieldErrors.body = "本文を入れてください";

  const plannedIso = plannedAt ? fromInputValue(plannedAt) : null;
  if (plannedAt && !plannedIso) fieldErrors.plannedAt = "日時の形式が正しくありません";

  const accounts = await connectedAccounts(projectId);
  const supabase = await createClient();

  // 送信済み・送信中・取り消し済みの配信先は、もう送らない
  const locked = new Set<SnsKey>();
  if (postId) {
    const { data: existing } = await supabase.from("post_targets").select("sns, status").eq("post_id", postId);
    for (const t of existing ?? []) {
      if (["published", "publishing", "deleted"].includes(t.status)) locked.add(t.sns as SnsKey);
    }
  }
  const toSend = targets.filter((t) => !locked.has(t.sns));

  if (intent !== "draft") {
    if (intent === "schedule") {
      if (!plannedIso && !fieldErrors.plannedAt) fieldErrors.plannedAt = "送る日時を決めてください";
      if (plannedIso && new Date(plannedIso).getTime() < Date.now() + MIN_LEAD_MS) {
        fieldErrors.plannedAt = "5 分以上先の日時にしてください";
      }
    }
    if (targets.length === 0) {
      fieldErrors.targets = "送り先の SNS を 1 つ以上選んでください";
    } else if (toSend.length === 0) {
      fieldErrors.targets = "選んだ SNS にはすべて送信済みです";
    } else {
      for (const t of toSend) {
        const label = SNS[t.sns].label;
        const issue = checkTarget(t.sns, t.bodyOverride ?? body).issues[0];
        if (issue) {
          fieldErrors.targets = `${label}: ${ISSUE_LABEL[issue]}`;
          break;
        }
        if (!accounts[t.sns]) {
          fieldErrors.targets = `${label} がつながっていないので送れません。下書きとして保存できます。`;
          break;
        }
        if (!canPublish(t.sns)) {
          fieldErrors.targets = `${label} への送信はまだ準備中です。下書きとして保存できます。`;
          break;
        }
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  // 失敗した配信先を、送り直せる状態に戻す
  if (intent !== "draft" && postId) {
    const { error } = await supabase.rpc("requeue_failed_targets", { p_post_id: postId, p_sns: toSend.map((t) => t.sns) });
    if (error) return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  }

  const sendAt = intent === "now" ? new Date().toISOString() : plannedIso;
  const { data: savedId, error } = await supabase.rpc("save_post", {
    p_post_id: postId as string,
    p_project_id: projectId,
    p_body: body,
    p_planned_at: sendAt as string,
    p_status: intent === "draft" ? "draft" : "scheduled",
    p_targets: targets.map((t) => ({
      sns: t.sns,
      body_override: t.bodyOverride,
      social_account_id: accounts[t.sns] ?? null,
    })),
  });
  if (error || !savedId) {
    return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  }

  if (intent === "now") {
    // 予約ジョブと重なっても、claim_due_targets が同じ配信先を 2 回取り出さない
    let done = "sent";
    try {
      const outcomes = await publishDueTargets(createAdminClient(), { adapters }, { postId: savedId });
      if (outcomes.length === 0) done = "sending";
      else if (outcomes.some((o) => o.result !== "published")) done = "send_failed";
    } catch (e) {
      console.error("[savePost] 送信に失敗しました", e);
      done = "send_failed";
    }
    revalidatePath(`/projects/${projectId}`, "layout");
    redirect(`/projects/${projectId}/posts/${savedId}?done=${done}`);
  }

  revalidatePath(`/projects/${projectId}`, "layout");

  if (intent === "schedule") {
    redirect(`/projects/${projectId}/calendar?week=${toYmd(new Date(plannedIso!))}&done=scheduled`);
  }
  redirect(`/projects/${projectId}/posts/${savedId}?done=saved`);
}

export async function deletePost(projectId: string, postId: string) {
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(postId).success) redirect("/projects");
  const supabase = await createClient();
  const { error } = await supabase.from("posts").delete().eq("project_id", projectId).eq("id", postId);
  if (error) throw new Error("投稿を削除できませんでした");
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`/projects/${projectId}/calendar?done=deleted`);
}
