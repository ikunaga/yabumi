import type { SupabaseClient } from "@supabase/supabase-js";
import { isKpiKey, recommendedKpis, type KpiKey } from "@/lib/metrics/kpis";
import { normalizePlan } from "@/lib/plan/schema";
import { loadRoadmapWith } from "@/lib/roadmap/load";
import { formatValue, itemProgress, weekStartOf } from "@/lib/roadmap/schema";
import { addItems, saveGoal, RoadmapError } from "@/lib/roadmap/write";
import { isManualSns, isSnsKey, SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { addDays, toYmd } from "@/lib/time";
import { checkAiLimits, type AiLimits } from "./limits";
import { normalizeConsultTurn, toWireConsultTurn, type ConsultAction, type ConsultTurn } from "./consult-schema";
import { CONSULT_SYSTEM, consultContextMessage, type ConsultContext } from "./consult-prompt";
import { MAX_TURNS_PER_THREAD, MAX_USER_TEXT, type BetaMessageParam, type BetaTextBlockParam, type CallModel, type ModelRequest, type ModelResult } from "./plan-coach";
import { estimateCostUsd } from "./pricing";

// AI と相談（F09、docs/architecture.md の 4.23）の会話の 1 往復。作りはアカウント設計の相棒（plan-coach.ts、4.9）と同じ。
// AI の呼び出しは callModel として外から渡す（テストではモックし、本物の API は呼ばない）

type Db = SupabaseClient<Database>;

// よくある相談（画面のボタン）。押すとそのまま最初の発言になる
export const CONSULT_TOPICS = {
  what_to_post: "何を投稿すればいいか、相談したいです。",
  no_reaction: "投稿しても反応がありません。どうすればいいですか。",
  which_sns: "どの SNS に力を入れればいいか、相談したいです。",
  roadmap: "最終の目標（KGI）と、週ごとのやること（ロードマップ）を一緒に決めたいです。",
  // 指標の画面の「AI と振り返る」から（4.22 の段取り ⑦）。この会話だけ、数字をくわしく「いまの状況」に足す
  review: "最近の数字を振り返って、よかった点と次の一手を教えてください。",
} as const;
export type ConsultTopic = keyof typeof CONSULT_TOPICS;

export function isConsultTopic(v: unknown): v is ConsultTopic {
  return typeof v === "string" && v in CONSULT_TOPICS;
}

export type ConsultUserContent =
  | { kind: "start"; topic: ConsultTopic }
  | { kind: "text"; text: string }
  | { kind: "adopt"; messageId: string; actionIndex: number; actionKind: ConsultAction["kind"]; title: string };

// AI の返事。採用した提案の番号を、あとから書き足す
export type ConsultAssistantContent = ConsultTurn & { adopted?: number[] };

export type ConsultMessage =
  | { id: string; role: "user"; content: ConsultUserContent; created_at: string }
  | { id: string; role: "assistant"; content: ConsultAssistantContent; created_at: string };

const ADOPTED_TEXT: Record<ConsultAction["kind"], string> = {
  plan_section: "アカウント設計を直しました",
  goal: "目標をロードマップに入れました",
  roadmap_items: "やることをロードマップに足しました",
  post_draft: "下書きを作りました",
};

export function consultUserText(c: ConsultUserContent): string {
  switch (c.kind) {
    case "start":
      return CONSULT_TOPICS[c.topic];
    case "text":
      return c.text;
    case "adopt":
      return `提案「${c.title}」を採用しました（${ADOPTED_TEXT[c.actionKind]}）。続けてください。`;
  }
}

// 履歴と「いまの状況」から、API に渡すリクエストを組み立てる（キャッシュの印の置き方は 4.9 と同じ）
export function buildConsultRequest(history: ConsultMessage[], ctx: ConsultContext): ModelRequest {
  const messages: BetaMessageParam[] = history.map((m) =>
    m.role === "user"
      ? { role: "user", content: [{ type: "text", text: consultUserText(m.content) }] }
      : { role: "assistant", content: [{ type: "text", text: JSON.stringify(toWireConsultTurn(m.content)) }] },
  );
  const last = messages[messages.length - 1];
  if (last && last.role === "user" && Array.isArray(last.content)) {
    (last.content[last.content.length - 1] as BetaTextBlockParam).cache_control = { type: "ephemeral" };
  }
  messages.push({ role: "system", content: consultContextMessage(ctx) } as unknown as BetaMessageParam);
  return { system: [{ type: "text", text: CONSULT_SYSTEM, cache_control: { type: "ephemeral" } }], messages };
}

// ===== 「いまの状況」を集める（利用者の権限のクライアントで。RLS で本人のものだけ） =====
// 選んだ KPI の今週・先週の数字（4.22 の数字の画面と同じもの。数えていないものは入れない）。サーバーでは loadMetricsOverview を渡す
export type LoadKpiValues = (user: Db, projectId: string) => Promise<Partial<Record<KpiKey, { thisWeek: number; lastWeek: number }>>>;

// 振り返りの材料（4.22 の数字の画面と同じもの）。サーバーでは loadMetricsOverview から作って渡す
export type ReviewNumbers = {
  kpiValues: Partial<Record<KpiKey, { thisWeek: number; lastWeek: number }>>;
  clicksBySns: { label: string; thisWeek: number; lastWeek: number; last30d: number }[];
  topClicked: { title: string; clicks: number }[];
  topViewed: { title: string; views: number }[];
};
export type LoadReviewNumbers = (user: Db, projectId: string) => Promise<ReviewNumbers>;

export function isReviewThread(history: ConsultMessage[]): boolean {
  const first = history[0];
  return first?.role === "user" && first.content.kind === "start" && first.content.topic === "review";
}

export async function gatherConsultContext(
  user: Db,
  projectId: string,
  now: Date,
  loadKpiValues: LoadKpiValues,
  loadReview?: LoadReviewNumbers,
): Promise<ConsultContext | null> {
  const { data: project } = await user
    .from("projects")
    .select("id, name, description, target_audience, app_store_url, play_store_url")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;
  const view = await loadRoadmapWith(user, projectId, now);
  const today = view.today;

  const [{ data: planRow }, { data: links }, { data: recent }, { data: clicksByPost }] = await Promise.all([
    user.from("account_plans").select("data").eq("project_id", projectId).maybeSingle(),
    user.from("project_social_accounts").select("social_accounts(sns, status)").eq("project_id", projectId),
    user
      .from("post_targets")
      .select("sns, published_at, post_id, body_override, posts!inner(project_id, body)")
      .eq("posts.project_id", projectId)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(30),
    user.rpc("top_posts_by_clicks", { p_project_id: projectId, p_today: today, p_days: 60, p_limit: 50 }),
  ]);

  const plan = normalizePlan(planRow?.data, project.target_audience);
  const connected = new Set<SnsKey>();
  for (const l of (links ?? []) as unknown as { social_accounts: { sns: string; status: string } | null }[]) {
    const a = l.social_accounts;
    if (a && a.status === "active" && isSnsKey(a.sns)) connected.add(a.sns);
  }

  // 最近の投稿: 投稿ごとにまとめて新しい 10 件
  const clicks = new Map((clicksByPost ?? []).map((c) => [c.post_id, Number(c.clicks)]));
  const posts = new Map<string, { date: string; sns: string[]; text: string; clicks: number }>();
  for (const t of (recent ?? []) as unknown as { sns: string; published_at: string; post_id: string; body_override: string | null; posts: { body: string } }[]) {
    const label = isSnsKey(t.sns) ? SNS[t.sns].label : t.sns;
    const existing = posts.get(t.post_id);
    if (existing) {
      if (!existing.sns.includes(label)) existing.sns.push(label);
      continue;
    }
    if (posts.size >= 10) continue;
    posts.set(t.post_id, { date: t.published_at.slice(0, 10), sns: [label], text: (t.body_override ?? t.posts.body).slice(0, 140), clicks: clicks.get(t.post_id) ?? 0 });
  }

  // 選んだ KPI（なければ目的からのおすすめ）と、ロードマップの KPI の数字。4.22 の数字の画面と同じもの（数えていないものは null）
  const kpiValues = await loadKpiValues(user, projectId);
  const kpis = (plan.first_month.kpis.length ? plan.first_month.kpis : recommendedKpis(plan.goal.goalType)).filter(isKpiKey);
  const roadmapKpis = view.roadmap?.kpiTargets.map((t) => t.kpi) ?? [];
  const kpiNumbers = [...new Set([...kpis, ...roadmapKpis])].map((kpi) => ({
    kpi,
    thisWeek: kpiValues[kpi]?.thisWeek ?? null,
    lastWeek: kpiValues[kpi]?.lastWeek ?? null,
  }));

  const nextWeek = addDays(view.thisWeek, 7);
  const r = view.roadmap;
  const review = loadReview ? await loadReview(user, projectId) : undefined;
  return {
    ...(review ? { review } : {}),
    today,
    project: { name: project.name, description: project.description, appStoreUrl: project.app_store_url, playStoreUrl: project.play_store_url },
    plan,
    connectedSns: [...connected].map((s) => SNS[s].label),
    manualSns: SNS_KEYS.filter(isManualSns).map((s) => SNS[s].label),
    recentPosts: [...posts.values()],
    kpiNumbers,
    roadmap: {
      kgi: r?.kgi ?? null,
      kpiTargets: (r?.kpiTargets ?? []).map((t) => ({ kpi: t.kpi, perWeek: t.per_week })),
      startedOn: r?.startedOn ?? null,
      items: view.items
        .filter((i) => i.weekStart === view.thisWeek || i.weekStart === nextWeek)
        .map((i) => {
          const p = itemProgress(i, view.daily);
          return { week: i.weekStart === view.thisWeek ? "今週" : "来週", title: i.title, status: i.status, progress: p && i.kpi ? `${formatValue(i.kpi, p.actual)} / ${formatValue(i.kpi, p.target)}` : null };
        }),
      kgiProgress: view.kgi && r?.kgi ? `${formatValue(r.kgi.kpi, view.kgi.actual)} / ${formatValue(r.kgi.kpi, view.kgi.target)}、残り ${view.kgi.daysLeft} 日` : null,
    },
  };
}

// ===== 提案を採用する（利用者の権限で書く。中身はサーバーに保存した AI の返事から読む） =====
export type ApplyResult = { ok: true; redirect?: string } | { ok: false; message: string };

// weekStart: 今週の月曜（AI は「何週目か」で出すので、ここで日付にする）
export async function applyConsultAction(user: Db, projectId: string, action: ConsultAction, weekStart: string): Promise<ApplyResult> {
  try {
    switch (action.kind) {
      case "plan_section": {
        const { error } = await user.rpc("save_account_plan_section", { p_project_id: projectId, p_section: action.section, p_value: action.value as never, p_source: "ai" });
        if (error) return { ok: false, message: "アカウント設計を保存できませんでした。時間をおいてもう一度お試しください。" };
        return { ok: true };
      }
      case "goal":
        await saveGoal(user, projectId, { kgi: action.kgi, kpiTargets: action.kpiTargets }, "ai");
        return { ok: true };
      case "roadmap_items":
        await addItems(
          user,
          projectId,
          action.items.map((i) => ({ title: i.title, detail: i.detail, week_start: addDays(weekStart, i.week * 7), kpi: i.kpi, target: i.target })),
          "ai",
        );
        return { ok: true };
      case "post_draft": {
        let accountId: string | null = null;
        if (action.sns && !isManualSns(action.sns)) {
          const { data: links } = await user.from("project_social_accounts").select("social_account_id, social_accounts(sns, status)").eq("project_id", projectId);
          const hit = ((links ?? []) as unknown as { social_account_id: string; social_accounts: { sns: string; status: string } | null }[]).find(
            (l) => l.social_accounts?.sns === action.sns && l.social_accounts.status === "active",
          );
          accountId = hit?.social_account_id ?? null;
        }
        const { data: postId, error } = await user.rpc("save_post", {
          p_post_id: null as unknown as string,
          p_project_id: projectId,
          p_body: action.text,
          p_planned_at: null as unknown as string,
          p_status: "draft",
          p_targets: action.sns ? [{ sns: action.sns, title: null, body_override: null, social_account_id: accountId }] : [],
        });
        if (error || !postId) return { ok: false, message: "下書きを保存できませんでした。時間をおいてもう一度お試しください。" };
        return { ok: true, redirect: `/projects/${projectId}/posts/${postId}?done=idea` };
      }
    }
  } catch (e) {
    if (e instanceof RoadmapError) return { ok: false, message: e.userMessage };
    throw e;
  }
}

// ===== 会話を 1 往復進める =====
export type ConsultInput =
  | { kind: "start"; topic: ConsultTopic }
  | { kind: "text"; text: string }
  | { kind: "adopt"; messageId: string; actionIndex: number };

export type ConsultDeps = { callModel: CallModel; limits: AiLimits; loadKpiValues: LoadKpiValues; loadReview?: LoadReviewNumbers; now?: () => Date };
export type ConsultResult = { ok: true; threadId: string; redirect?: string } | { ok: false; threadId: string | null; message: string };

const GENERIC_ERROR = "AI とのやりとりがうまくいきませんでした。時間をおいてもう一度お試しください。";

// user: 利用者の権限（状況の読み込みと、提案の採用。RLS で本人のものだけ）
// admin: サーバーの権限（会話と利用量の書き込み）。呼ぶ前に userId がログイン中の利用者であることを確かめておく
export async function consultStep(
  user: Db,
  admin: Db,
  deps: ConsultDeps,
  args: { userId: string; projectId: string; threadId: string | null; input: ConsultInput },
): Promise<ConsultResult> {
  const now = deps.now?.() ?? new Date();
  const { userId, projectId, input } = args;

  if (input.kind === "text") {
    const text = input.text.trim();
    if (!text) return { ok: false, threadId: args.threadId, message: "メッセージを入れてください。" };
    if (text.length > MAX_USER_TEXT) return { ok: false, threadId: args.threadId, message: `${MAX_USER_TEXT.toLocaleString("ja-JP")} 文字以内にしてください。` };
  }
  const { data: project } = await user.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return { ok: false, threadId: args.threadId, message: "プロジェクトが見つかりません。" };

  const limit = await checkAiLimits(admin, userId, deps.limits, now);
  if (!limit.ok) return { ok: false, threadId: args.threadId, message: limit.message };

  let threadId = args.threadId;
  let createdThread = false;
  if (threadId) {
    const { data: t } = await admin.from("ai_threads").select("id").eq("id", threadId).eq("owner_id", userId).eq("project_id", projectId).eq("purpose", "consult").maybeSingle();
    if (!t) return { ok: false, threadId: null, message: "会話が見つかりません。画面を読み込み直してください。" };
  } else {
    if (input.kind === "adopt") return { ok: false, threadId: null, message: "提案が見つかりません。画面を読み込み直してください。" };
    const { data: t, error } = await admin.from("ai_threads").insert({ owner_id: userId, project_id: projectId, purpose: "consult" }).select("id").single();
    if (error) throw error;
    threadId = t.id;
    createdThread = true;
  }

  const history = await loadConsultHistory(admin, threadId);
  if (history.length >= MAX_TURNS_PER_THREAD * 2) {
    return { ok: false, threadId, message: "この会話は長くなったので、ここまでにしましょう。「新しい相談」で続きを始められます（決めたことは残ります）。" };
  }

  // 利用者の発言を決める。採用のときは、ここで設計・ロードマップ・下書きに入れる
  let userContent: ConsultUserContent;
  let redirect: string | undefined;
  if (input.kind === "start") userContent = { kind: "start", topic: input.topic };
  else if (input.kind === "text") userContent = { kind: "text", text: input.text.trim() };
  else {
    const target = history.find((m) => m.id === input.messageId);
    const action = target?.role === "assistant" ? target.content.actions[input.actionIndex] : undefined;
    if (!target || target.role !== "assistant" || !action) return { ok: false, threadId, message: "提案が見つかりません。画面を読み込み直してください。" };
    if (target.content.adopted?.includes(input.actionIndex)) return { ok: false, threadId, message: "この提案は採用済みです。" };
    const applied = await applyConsultAction(user, projectId, action, weekStartOf(toYmd(now)));
    if (!applied.ok) return { ok: false, threadId, message: applied.message };
    redirect = applied.redirect;
    await admin
      .from("ai_messages")
      .update({ content: { ...target.content, adopted: [...(target.content.adopted ?? []), input.actionIndex] } as never })
      .eq("id", target.id);
    userContent = { kind: "adopt", messageId: target.id, actionIndex: input.actionIndex, actionKind: action.kind, title: action.title };
    // 下書きを作ったら、その画面に移る。AI の返事は待たない（下書きを直すのが先なので）
    if (redirect) {
      await admin.from("ai_messages").insert({ thread_id: threadId, owner_id: userId, role: "user", content: userContent as never });
      await admin.from("ai_threads").update({ updated_at: now.toISOString() }).eq("id", threadId);
      return { ok: true, threadId, redirect };
    }
  }

  const { data: inserted, error: insertError } = await admin
    .from("ai_messages")
    .insert({ thread_id: threadId, owner_id: userId, role: "user", content: userContent as never })
    .select("id, created_at")
    .single();
  if (insertError) throw insertError;
  history.push({ id: inserted.id, role: "user", content: userContent, created_at: inserted.created_at });

  const fail = async (message: string): Promise<ConsultResult> => {
    if (createdThread) {
      await admin.from("ai_threads").delete().eq("id", threadId);
      return { ok: false, threadId: null, message };
    }
    // 採用は済んでいるので、採用の記録は残す
    if (userContent.kind !== "adopt") await admin.from("ai_messages").delete().eq("id", inserted.id);
    return { ok: false, threadId, message };
  };

  // 振り返りの会話だけ、数字をくわしく足す（ふだんの相談は短く保ち、費用を抑える）
  const ctx = await gatherConsultContext(user, projectId, now, deps.loadKpiValues, isReviewThread(history) ? deps.loadReview : undefined);
  if (!ctx) return fail("プロジェクトが見つかりません。");

  const recordUsage = (r: ModelResult) =>
    admin.from("ai_usage").insert({
      owner_id: userId,
      thread_id: threadId,
      purpose: "consult",
      model: r.model,
      input_tokens: r.usage.inputTokens,
      cache_write_tokens: r.usage.cacheWriteTokens,
      cache_read_tokens: r.usage.cacheReadTokens,
      output_tokens: r.usage.outputTokens,
      cost_usd: estimateCostUsd(r.model, r.usage),
    });

  const request = buildConsultRequest(history, ctx);
  let result: ModelResult;
  try {
    result = await deps.callModel(request);
  } catch (e) {
    console.error("[consult] AI の呼び出しに失敗しました", e instanceof Error ? e.message : e);
    return fail(GENERIC_ERROR);
  }
  // 使った分は、返事が使えなくても記録する（上限の計算に入れる）
  await recordUsage(result);
  if (result.stopReason === "refusal") return fail("AI がこの内容には答えられませんでした。言い方を変えてもう一度お試しください。");
  let turn = result.stopReason === "max_tokens" ? null : normalizeConsultTurn(result.turn);
  if (!turn || !turn.message) return fail(GENERIC_ERROR);

  // 提案の中身が形に合わなかったときは、理由を伝えて 1 回だけ言い直させる
  if (turn.actionProblem) {
    try {
      const retry = await deps.callModel({
        system: request.system,
        messages: [
          ...request.messages,
          { role: "assistant", content: [{ type: "text", text: JSON.stringify(result.turn) }] },
          {
            role: "user",
            content: [{ type: "text", text: `（矢書からの自動の連絡）提案の value_json が決められた形に合いませんでした: ${turn.actionProblem}。「提案の中身の形」に合わせて直し、同じ返事の形でもう一度返してください。` }],
          },
        ],
      });
      await recordUsage(retry);
      const fixed = retry.stopReason === "end_turn" ? normalizeConsultTurn(retry.turn) : null;
      if (fixed?.message && !fixed.actionProblem) turn = fixed;
    } catch (e) {
      console.error("[consult] 言い直しの呼び出しに失敗しました", e instanceof Error ? e.message : e);
    }
  }

  const { actionProblem: _ignored, ...toSave } = turn;
  void _ignored;
  const { error } = await admin.from("ai_messages").insert({ thread_id: threadId, owner_id: userId, role: "assistant", content: { ...toSave, adopted: [] } as never });
  if (error) throw error;
  await admin.from("ai_threads").update({ updated_at: now.toISOString() }).eq("id", threadId);
  return { ok: true, threadId };
}

export async function loadConsultHistory(db: Db, threadId: string): Promise<ConsultMessage[]> {
  const { data, error } = await db.from("ai_messages").select("id, role, content, created_at").eq("thread_id", threadId).order("created_at").order("id");
  if (error) throw error;
  return data as unknown as ConsultMessage[];
}
