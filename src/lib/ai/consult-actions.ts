"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadMetricsOverview } from "@/lib/metrics/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured, callConsult } from "./anthropic";
import { MAX_ACTIONS } from "./consult-schema";
import { consultStep, isConsultTopic, type ConsultInput } from "./consult";
import { aiLimitsFromEnv } from "./limits";
import { MAX_USER_TEXT } from "./plan-coach";

const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start"), topic: z.string() }),
  z.object({ kind: z.literal("text"), text: z.string().max(MAX_USER_TEXT * 2) }),
  z.object({ kind: z.literal("adopt"), messageId: z.uuid(), actionIndex: z.number().int().min(0).max(MAX_ACTIONS - 1) }),
]);

export type ConsultActionResult = { ok: boolean; threadId: string | null; message?: string; redirect?: string };

// AI と相談の会話を 1 往復進める（AI の返事を待つので、数秒〜数十秒かかる）
export async function sendConsultMessage(projectId: string, threadId: string | null, rawInput: unknown): Promise<ConsultActionResult> {
  if (!z.uuid().safeParse(projectId).success || (threadId !== null && !z.uuid().safeParse(threadId).success)) {
    return { ok: false, threadId, message: "入力の形式が正しくありません。" };
  }
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, threadId, message: "入力の形式が正しくありません。" };
  let input: ConsultInput;
  if (parsed.data.kind === "start") {
    if (!isConsultTopic(parsed.data.topic)) return { ok: false, threadId, message: "入力の形式が正しくありません。" };
    input = { kind: "start", topic: parsed.data.topic };
  } else input = parsed.data;

  if (!aiConfigured()) return { ok: false, threadId, message: "AI はまだ準備中です。" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { ok: false, threadId, message: "ログインし直してください。" };

  try {
    // 数字は 1 往復で 1 回だけ読む（振り返りのときは KPI と材料の両方で使う）
    let overview: ReturnType<typeof loadMetricsOverview> | null = null;
    const loadOverview = (user: Parameters<typeof loadMetricsOverview>[1], id: string) => (overview ??= loadMetricsOverview(id, user));
    const result = await consultStep(
      supabase,
      createAdminClient(),
      {
        callModel: callConsult,
        limits: aiLimitsFromEnv(),
        loadKpiValues: async (user, id) => (await loadOverview(user, id)).kpiValues,
        // 振り返り（指標の画面の「AI と振り返る」）のときだけ読む
        loadReview: async (user, id) => {
          const o = await loadOverview(user, id);
          return {
            kpiValues: o.kpiValues,
            clicksBySns: o.clicksBySns.map((c) => ({ label: c.label, thisWeek: c.thisWeek, lastWeek: c.lastWeek, last30d: c.last30d })),
            topClicked: o.topPosts.map((p) => ({ title: p.title, clicks: p.clicks })),
            topViewed: o.topViewed.map((p) => ({ title: p.title, views: p.views })),
          };
        },
      },
      { userId, projectId, threadId, input },
    );
    revalidatePath(`/projects/${projectId}`, "layout");
    return result.ok ? { ok: true, threadId: result.threadId, redirect: result.redirect } : { ok: false, threadId: result.threadId, message: result.message };
  } catch (e) {
    console.error("[sendConsultMessage]", e);
    return { ok: false, threadId, message: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}
