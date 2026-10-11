"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ISSUE_LABEL, SNS, checkTarget, isManualSns, type SnsKey } from "@/lib/sns";
import { canPublish, publisherDeps } from "@/lib/sns/adapters";
import { publishDueTargets } from "@/lib/sns/publisher";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fromInputValue, toYmd } from "@/lib/time";
import { needsFillIn } from "@/lib/ai/post-ideas";
import { snsNeedingImageReconnect } from "@/lib/media/queries";
import { MediaError, attachMedia } from "@/lib/media/store";
import { preparePostLinks } from "@/lib/links/store";
import { connectedAccounts } from "./queries";
import { savePostInputSchema, type SavePostInput, type SavePostResult } from "./schema";

// 予約は少なくとも 5 分後から（送信ジョブの間隔より余裕を持たせる）
const MIN_LEAD_MS = 5 * 60 * 1000;

export async function savePost(input: SavePostInput): Promise<SavePostResult> {
  const parsed = savePostInputSchema.safeParse(input);
  if (!parsed.success) return { error: "入力の形式が正しくありません。画面を読み込み直してください。" };
  const { projectId, postId, body, targets, plannedAt, intent, media, shortLinks } = parsed.data;

  const fieldErrors: NonNullable<SavePostResult["fieldErrors"]> = {};
  if (body.trim() === "") fieldErrors.body = "本文を入れてください";

  const plannedIso = plannedAt ? fromInputValue(plannedAt) : null;
  if (plannedAt && !plannedIso) fieldErrors.plannedAt = "日時の形式が正しくありません";

  const accounts = await connectedAccounts(projectId);
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "ログインし直してください。" };
  const images = media.length;
  const needReconnect = images > 0 ? await snsNeedingImageReconnect(accounts) : [];
  // Instagram は縦横比を確かめるので、画像の幅と高さを読む（RLS で本人の画像だけ）
  let sizes: { width: number; height: number }[] | undefined;
  if (images > 0 && targets.some((t) => t.sns === "instagram")) {
    const { data: rows } = await supabase.from("media_files").select("id, width, height").in("id", media.map((m) => m.id));
    sizes = (rows ?? []).map((r) => ({ width: r.width, height: r.height }));
  }

  // 送信済み・送信中・取り消し済みの配信先は、もう送らない
  const locked = new Set<SnsKey>();
  if (postId) {
    const { data: existing } = await supabase.from("post_targets").select("sns, status").eq("post_id", postId);
    for (const t of existing ?? []) {
      if (["published", "preparing", "publishing", "deleted"].includes(t.status)) locked.add(t.sns as SnsKey);
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
    } else if (intent === "now" && toSend.every((t) => isManualSns(t.sns))) {
      fieldErrors.targets = "note・Substack は手で投稿します。予約か下書き保存をすると、投稿の画面から手で投稿できます";
    } else {
      for (const t of toSend) {
        const label = SNS[t.sns].label;
        const issue = checkTarget(t.sns, t.bodyOverride ?? body, { images, videos: 0, sizes }, t.title ?? null).issues[0];
        if (issue) {
          fieldErrors.targets = `${label}: ${ISSUE_LABEL[issue]}`;
          break;
        }
        // AI のネタの【作品名】のような、利用者が書き換える印が残っていたら送らない
        if (needsFillIn(t.bodyOverride ?? body) || needsFillIn(t.title ?? "")) {
          fieldErrors.targets = `${label}: 【】で囲んだところを、自分の言葉に書き換えてください`;
          break;
        }
        // 手で投稿する SNS は、つながず、送信の部品もいらない
        if (isManualSns(t.sns)) continue;
        if (!accounts[t.sns]) {
          fieldErrors.targets = `${label} がつながっていないので送れません。下書きとして保存できます。`;
          break;
        }
        if (!canPublish(t.sns)) {
          fieldErrors.targets = `${label} への送信はまだ準備中です。下書きとして保存できます。`;
          break;
        }
        // 画像を送るのに要る権限がない（X は media.write を足す前につないだアカウント）
        if (needReconnect.includes(t.sns)) {
          fieldErrors.targets = `${label} に画像を送るには、つなぎ直しが要ります。概要の「つないだ SNS」から ${label} をつなぎ直してください。`;
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
      title: SNS[t.sns].needsTitle ? (t.title ?? null) : null,
      body_override: t.bodyOverride,
      social_account_id: isManualSns(t.sns) ? null : (accounts[t.sns] ?? null),
    })),
  });
  if (error || !savedId) {
    return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  }

  // 画像を、渡した順と代わりの文にそろえる（外した画像は消える）。送る前に済ませる
  try {
    await attachMedia(createAdminClient(), userId, savedId, media.map((m) => ({ id: m.id, altText: m.altText })));
  } catch (e) {
    if (e instanceof MediaError) return { fieldErrors: { media: e.userMessage } };
    console.error("[savePost] 画像を保存できませんでした", e);
    return { error: "画像を保存できませんでした。時間をおいてもう一度お試しください。" };
  }

  // 本文の URL の短縮リンクを用意する（送るときに置き換わる。4.22）。失敗しても保存は済んでいるので、元の URL のまま送る
  try {
    await preparePostLinks(createAdminClient(), { ownerId: userId, projectId, postId: savedId, enabled: shortLinks });
  } catch (e) {
    console.error("[savePost] 短縮リンクを用意できませんでした", e);
  }

  if (intent === "now") {
    // 予約ジョブと重なっても、claim_due_targets が同じ配信先を 2 回取り出さない
    let done = "sent";
    try {
      const outcomes = await publishDueTargets(createAdminClient(), publisherDeps(), { postId: savedId });
      if (outcomes.length === 0) done = "sending";
      else if (outcomes.some((o) => o.result === "failed" || o.result === "retry")) done = "send_failed";
      // 画像の準備中（Threads・Instagram）や、時間が足りず次の回に回したものは、次の送信ジョブ（1 分ごと）で続きを送る
      else if (outcomes.some((o) => o.result === "preparing" || o.result === "deferred")) done = "preparing";
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

// 失敗したときは { error } を返し、作成画面に出す（成功したときはカレンダーへ移る）
export async function deletePost(projectId: string, postId: string): Promise<{ error?: string }> {
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(postId).success) redirect("/projects");
  const supabase = await createClient();
  const { error } = await supabase.from("posts").delete().eq("project_id", projectId).eq("id", postId);
  if (error) return { error: "投稿を削除できませんでした。時間をおいて、もう一度お試しください。" };
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`/projects/${projectId}/calendar?done=deleted`);
}
