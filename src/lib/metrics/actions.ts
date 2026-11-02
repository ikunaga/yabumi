"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { OUTCOME_ACTIONS } from "@/lib/projects/product-types";

// note・Substack の数字を手で記録する（docs/architecture.md の 4.22）。RLS で、本人の手で投稿する SNS の配信先にだけ書ける

const count = z
  .string()
  .trim()
  .transform((v) => v.replace(/[,，\s]/g, ""))
  .refine((v) => v === "" || /^[0-9]{1,9}$/.test(v), "0 以上の整数で入れてください")
  .transform((v) => (v === "" ? null : Number(v)));

export type ManualMetricState = { error?: string; ok?: boolean };

export async function saveManualMetric(projectId: string, targetId: string, _prev: ManualMetricState, formData: FormData): Promise<ManualMetricState> {
  if (!z.uuid().safeParse(targetId).success || !z.uuid().safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };
  const views = count.safeParse(String(formData.get("views") ?? ""));
  const reactions = count.safeParse(String(formData.get("reactions") ?? ""));
  if (!views.success || !reactions.success) return { error: "数字は 0 以上の整数で入れてください。" };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "ログインし直してください。" };
  // 書き換えられるのは数字と記録した日時の列だけ（列ごとの権限）なので、まず書き換え、なければ足す
  const values = { views: views.data, reactions: reactions.data, recorded_at: new Date().toISOString() };
  const { data: updated, error: updateError } = await supabase.from("manual_post_metrics").update(values).eq("post_target_id", targetId).select("post_target_id");
  if (updateError) return { error: "記録できませんでした。時間をおいてもう一度お試しください。" };
  if (!updated?.length) {
    const { error } = await supabase.from("manual_post_metrics").insert({ post_target_id: targetId, owner_id: userId, ...values });
    if (error) return { error: "記録できませんでした。手で投稿した note・Substack の投稿だけ記録できます。" };
  }
  revalidatePath(`/projects/${projectId}/metrics`);
  return { ok: true };
}

// 成果を手で記録する（決定 D34。project_outcomes_daily）。日と成果の種類ごとに 1 行で、入れ直すと上書きする。0 を入れると消す。
// RLS で、本人の自分のプロジェクトにだけ書ける

const outcomeSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付を選んでください"),
  action: z.enum(OUTCOME_ACTIONS, { message: "成果の種類を選んでください" }),
  count: z
    .string()
    .trim()
    .transform((v) => v.replace(/[,，\s]/g, ""))
    .refine((v) => /^[0-9]{1,6}$/.test(v) && Number(v) <= 100000, "0〜100,000 の整数で入れてください")
    .transform(Number),
});

export type OutcomeState = { error?: string; ok?: boolean };

export async function saveOutcome(projectId: string, _prev: OutcomeState, formData: FormData): Promise<OutcomeState> {
  if (!z.uuid().safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };
  const parsed = outcomeSchema.safeParse({ day: String(formData.get("day") ?? ""), action: String(formData.get("action") ?? ""), count: String(formData.get("count") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { day, action, count: n } = parsed.data;
  // 未来の日は入れられない（日本時間の今日まで）
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  if (day > today) return { error: "今日までの日を選んでください。" };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "ログインし直してください。" };
  const { error } =
    n === 0
      ? await supabase.from("project_outcomes_daily").delete().eq("project_id", projectId).eq("day", day).eq("action", action)
      : await supabase.from("project_outcomes_daily").upsert({ project_id: projectId, owner_id: userId, day, action, count: n }, { onConflict: "project_id,day,action" });
  if (error) return { error: "記録できませんでした。時間をおいてもう一度お試しください。" };
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}
