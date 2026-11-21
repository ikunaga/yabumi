"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadMetricsOverview } from "@/lib/metrics/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured, callConsult, callShortenDrafts } from "./anthropic";
import { MAX_OPTIONS } from "./consult-schema";
import { closeConsultThread, consultBegin, consultReply, isConsultTopic, type ConsultDeps, type ConsultInput } from "./consult";
import { MAX_USER_TEXT } from "./plan-coach";

const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start"), topic: z.string(), itemId: z.uuid().optional(), goalId: z.uuid().optional() }),
  z.object({ kind: z.literal("text"), text: z.string().max(MAX_USER_TEXT * 2) }),
  z.object({ kind: z.literal("adopt"), messageId: z.uuid(), actionIndex: z.number().int().min(0).max(MAX_OPTIONS - 1) }),
]);

// replying: 返事はサーバーが after() で作っている（画面は読み直しで待つ）
export type ConsultActionResult = { ok: boolean; threadId: string | null; message?: string; redirect?: string; replying?: boolean };

// AI と相談の会話に発言を送る。発言を保存したらすぐ返し、AI の返事は after() でサーバーが作り続ける（画面を離れても止まらない。2026-11-21 オーナーの指摘）
export async function sendConsultMessage(projectId: string, threadId: string | null, rawInput: unknown): Promise<ConsultActionResult> {
  if (!z.uuid().safeParse(projectId).success || (threadId !== null && !z.uuid().safeParse(threadId).success)) {
    return { ok: false, threadId, message: "入力の形式が正しくありません。" };
  }
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, threadId, message: "入力の形式が正しくありません。" };
  let input: ConsultInput;
  if (parsed.data.kind === "start") {
    if (!isConsultTopic(parsed.data.topic)) return { ok: false, threadId, message: "入力の形式が正しくありません。" };
    input = { kind: "start", topic: parsed.data.topic, ...(parsed.data.itemId ? { itemId: parsed.data.itemId } : {}), ...(parsed.data.goalId ? { goalId: parsed.data.goalId } : {}) };
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
    const user = supabase;
    const admin = createAdminClient();
    const deps: ConsultDeps = {
      callModel: callConsult,
      callShorten: callShortenDrafts,
      loadKpiValues: async (u, id) => (await loadOverview(u, id)).kpiValues,
      // 振り返り（分析の画面の「AI と振り返る」）のときだけ読む
      loadReview: async (u, id) => {
        const o = await loadOverview(u, id);
        return {
          kpiValues: o.kpiValues,
          clicksBySns: o.clicksBySns.map((c) => ({ label: c.label, thisWeek: c.thisWeek, lastWeek: c.lastWeek, last30d: c.last30d })),
          topClicked: o.topPosts.map((p) => ({ title: p.title, clicks: p.clicks })),
          topViewed: o.topViewed.map((p) => ({ title: p.title, views: p.views })),
        };
      },
    };
    const result = await consultBegin(user, admin, deps, { userId, projectId, threadId, input });
    const job = result.ok ? result.job : undefined;
    // 応答を返したあとも、このルートの maxDuration（consult のページで 120 秒）まで走る。失敗は consultReply が会話に印を付ける
    if (job) after(() => consultReply(user, admin, deps, job).then(() => undefined));
    revalidatePath(`/projects/${projectId}`, "layout");
    return result.ok ? { ok: true, threadId: result.threadId, redirect: result.redirect, replying: Boolean(job) } : { ok: false, threadId: result.threadId, message: result.message };
  } catch (e) {
    console.error("[sendConsultMessage]", e);
    return { ok: false, threadId, message: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}

// 相談を終える（済みにして、元の画面に戻る）。AI は呼ばない。本人の会話だけ（closeConsultThread で RLS を使って確かめる）
export async function closeConsultThreadAction(projectId: string, threadId: string): Promise<{ error?: string }> {
  if (!z.array(z.uuid()).safeParse([projectId, threadId]).success) return { error: "入力の形式が正しくありません。" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: "ログインし直してください。" };
  let to: string;
  try {
    const r = await closeConsultThread(supabase, createAdminClient(), { userId, projectId, threadId });
    if (!r.ok) return { error: r.message };
    to = r.redirect;
  } catch (e) {
    console.error("[closeConsultThreadAction]", e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(to);
}
