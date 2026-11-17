import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAiCheckRequest, dedupeTexts, normalizeAiCheck, type CallCheck, type CheckText } from "@/lib/ai/ai-check";
import { budgeted, withAiBudget } from "@/lib/ai/budget";
import { productTypeOf } from "@/lib/ai/product-guide";
import { ideaContextText } from "@/lib/ai/post-ideas";
import { overLimit, shortenOverDrafts, type CallShorten } from "@/lib/ai/shorten";
import { copyNoteImagesToPost } from "@/lib/notes/store";
import { normalizePlan, type PlanData } from "@/lib/plan/schema";
import { loadVoiceContext } from "@/lib/plan/voice";
import { sendPush, type PushMessage } from "@/lib/push/send";
import { isManualSns, SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { autoPostGenerator, fakeAiMode, type AutoPostGenerator } from "./ai";
import { callAiCheck, callShortenDrafts } from "@/lib/ai/anthropic";
import { applyAiCheck, plainIssues, type Issue, type Texts } from "./checks";
import { isNoMaterial, pickMaterial, type Material, type MaterialDeps, type PastRef, type ProjectRow } from "./materials";
import { toPlan } from "./plan-row";
import { dueTimes } from "./schedule";
import type { AutoPlan, AutoRunReason, AutoRunStatus, AutoStopReason } from "./types";
import { STOP_REASON_TEXT } from "./labels";

// 自動の投稿のジョブ（docs/design/auto-post.md の 2.3・2.7）。サーバーの権限（admin）で動くので、読むものは必ず持ち主とプロジェクトで絞る。
// 1 回の流れ: ① 14 日先までの回を足す → ② 送る時刻を過ぎた確かめ待ちを失敗にする・最初の回の確かめの後始末 → ③ 作る時刻が来た回を作る →
// ④ 回し方の状態（続けての失敗・材料切れ・つながり）を見直す → ⑤ 知らせる（作った・確かめ待ちの 2 時間前）

type Db = SupabaseClient<Database>;

export const AHEAD_DAYS = 14;
export const RECENT_DAYS = 30;
export const RECENT_FOR_AI = 10;
export const DAILY_PER_SNS = 2; // 1 人の自動の回は、1 日に SNS ごとに 2 本まで（2.7）
export const FAIL_STREAK_STOP = 2;
export const MATERIALS_OUT_STOP = 3;
export const REMIND_BEFORE_MS = 2 * 3_600_000;
// 送る時刻のあと、結果を見るまで待つ（送信ジョブの 3 回のやり直し〈1 分・5 分〉と、準備中の公開が済むまで）
export const SETTLE_AFTER_MS = 15 * 60_000;
export const EXPIRED_MESSAGE = "確かめられないまま送る時刻を過ぎたので、送りませんでした。送るときは、日時を直して確かめてください。";
export const REVIEW_EXPIRED_DETAIL = "最初の回を確かめないまま、送る時刻を過ぎました";

export type EngineDeps = {
  generator: AutoPostGenerator;
  callCheck: CallCheck;
  callShorten?: CallShorten;
  push?: (admin: Db, userId: string, msg: PushMessage) => Promise<unknown>;
  now?: () => Date;
} & MaterialDeps;

// ownerIds: 結合テストで、テストの利用者だけを扱う（共有のローカル DB のほかの人の行に触らない）。ジョブは渡さない
export type EngineOpts = { ownerIds?: string[]; limit?: number };

export type JobSummary = { added: number; expired: number; made: Partial<Record<AutoRunStatus, number>>; stopped: number; notified: number; reminded: number };

const jstHm = (d: Date) => {
  const j = new Date(d.getTime() + 9 * 3_600_000);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
};
const jstDayRange = (d: Date) => {
  const day = new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00+09:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
};
// SNS の名前を、いつも同じ並び（SNS_KEYS の順）で
const labels = (sns: SnsKey[]) => SNS_KEYS.filter((k) => sns.includes(k)).map((s) => SNS[s].label).join("・");

function scope<Q extends { in: (col: string, v: string[]) => Q }>(q: Q, opts: EngineOpts, col = "owner_id"): Q {
  return opts.ownerIds ? q.in(col, opts.ownerIds) : q;
}

// ===== ① これからの回を足す =====
export async function addUpcomingRuns(admin: Db, now: Date, opts: EngineOpts = {}): Promise<number> {
  const { data: plans, error } = await scope(admin.from("auto_plans").select("id, owner_id, project_id, schedule, lead_hours").eq("status", "active"), opts);
  if (error) throw error;
  const until = new Date(now.getTime() + AHEAD_DAYS * 86_400_000);
  const rows = plans.flatMap((p) =>
    dueTimes(p.schedule as never, now, until).map((due) => ({
      plan_id: p.id,
      owner_id: p.owner_id,
      project_id: p.project_id,
      due_at: due.toISOString(),
      generate_at: new Date(due.getTime() - p.lead_hours * 3_600_000).toISOString(),
    })),
  );
  if (!rows.length) return 0;
  const { data, error: e2 } = await admin.from("auto_runs").upsert(rows, { onConflict: "plan_id,due_at", ignoreDuplicates: true }).select("id");
  if (e2) throw e2;
  return data.length;
}

// ===== ② 送る時刻を過ぎた確かめ待ち =====
// 確かめ待ちの配信先は失敗にする（送り直すと、承認の記録がなければ確かめ待ちに戻る。requeue_failed_targets）。
// 最初の回の確かめ（review）のまま過ぎた回は取り消す（投稿は下書きのまま残る）。利用者が投稿の画面で予約にした review の回は、確かめが済んだものとして扱う
export async function settleApprovals(admin: Db, now: Date, opts: EngineOpts = {}): Promise<number> {
  const { data: late, error } = await scope(
    admin.from("posts").select("id, post_targets!inner(id)").not("auto_run_id", "is", null).lte("planned_at", now.toISOString()).eq("post_targets.status", "awaiting_approval"),
    opts,
  );
  if (error) throw error;
  const ids = late.flatMap((p) => p.post_targets.map((t) => t.id));
  if (ids.length) {
    const { error: e } = await admin.from("post_targets").update({ status: "failed", error_message: EXPIRED_MESSAGE, locked_at: null }).in("id", ids).eq("status", "awaiting_approval");
    if (e) throw e;
  }

  const { data: reviews, error: e3 } = await scope(admin.from("auto_runs").select("id, plan_id, due_at, posts!auto_runs_post_id_fkey(status)").eq("status", "review"), opts);
  if (e3) throw e3;
  for (const r of reviews) {
    const post = r.posts as { status: string } | null;
    if (post?.status === "scheduled") {
      await admin.from("auto_runs").update({ status: "scheduled", updated_at: now.toISOString() }).eq("id", r.id).eq("status", "review");
      await admin.from("auto_plans").update({ first_review: false, updated_at: now.toISOString() }).eq("id", r.plan_id);
    } else if (new Date(r.due_at) <= now) {
      await admin.from("auto_runs").update({ status: "canceled", reason: "user_skipped", reason_detail: REVIEW_EXPIRED_DETAIL, updated_at: now.toISOString() }).eq("id", r.id).eq("status", "review");
    }
  }
  return ids.length;
}

// ===== ③ 作る =====

// 材料を選ぶときに見る前の回。書けなかった回（skipped・cannot_write）も、選んだ材料を記録に残しているので数える（同じ材料を選び続けない）
const PAST_STATUSES: AutoRunStatus[] = ["generating", "scheduled", "review", "held", "skipped"];

type ClaimedRun = { id: string; plan_id: string; owner_id: string; project_id: string; due_at: string };

async function finish(admin: Db, runId: string, patch: { status: AutoRunStatus; reason?: AutoRunReason | null; detail?: string | null; postId?: string | null; ref?: Record<string, unknown> }) {
  const { error } = await admin
    .from("auto_runs")
    .update({
      status: patch.status,
      reason: patch.reason ?? null,
      reason_detail: patch.detail ? patch.detail.slice(0, 200) : null,
      ...(patch.postId !== undefined ? { post_id: patch.postId } : {}),
      ...(patch.ref ? { material_ref: patch.ref as never } : {}),
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) throw error;
}

// つないでいて使える SNS のアカウント（プロジェクトごと。SNS ごとに 1 つ）
async function connectedAccounts(admin: Db, projectId: string, ownerId: string): Promise<Partial<Record<SnsKey, string>>> {
  const { data, error } = await admin
    .from("project_social_accounts")
    .select("social_account_id, social_accounts!inner(sns, status, owner_id)")
    .eq("project_id", projectId)
    .eq("owner_id", ownerId);
  if (error) throw error;
  const out: Partial<Record<SnsKey, string>> = {};
  for (const r of data) {
    const a = r.social_accounts as { sns: string; status: string; owner_id: string };
    if (a.status === "active" && a.owner_id === ownerId) out[a.sns as SnsKey] = r.social_account_id;
  }
  return out;
}

// その日（日本時間）に、すでに自動の回で予約・送った本数（SNS ごと）
async function autoCountsOnDay(admin: Db, ownerId: string, due: Date, exceptRun: string): Promise<Partial<Record<SnsKey, number>>> {
  const { start, end } = jstDayRange(due);
  const { data, error } = await admin
    .from("posts")
    .select("auto_run_id, post_targets(sns, status)")
    .eq("owner_id", ownerId)
    .not("auto_run_id", "is", null)
    .neq("auto_run_id", exceptRun)
    .gte("planned_at", start.toISOString())
    .lt("planned_at", end.toISOString());
  if (error) throw error;
  const out: Partial<Record<SnsKey, number>> = {};
  for (const p of data) for (const t of p.post_targets) if (t.status !== "deleted") out[t.sns as SnsKey] = (out[t.sns as SnsKey] ?? 0) + 1;
  return out;
}

// 同じプロジェクトで直近 30 日に送った・予約した本文（SNS ごと。重なりのチェック）と、この回し方の直近の本文（AI に渡す）
export async function recentTexts(admin: Db, projectId: string, ownerId: string, planId: string, now: Date) {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("posts")
    .select("body, planned_at, auto_run_id, post_targets(sns, body_override, status), auto_runs!posts_auto_run_id_fkey(plan_id)")
    .eq("project_id", projectId)
    .eq("owner_id", ownerId)
    .gte("planned_at", since)
    .order("planned_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const bySns: Partial<Record<SnsKey, string[]>> = {};
  const mine: string[] = [];
  for (const p of data) {
    for (const t of p.post_targets) {
      if (!["pending", "awaiting_approval", "preparing", "publishing", "published"].includes(t.status)) continue;
      (bySns[t.sns as SnsKey] ??= []).push(t.body_override ?? p.body);
    }
    if ((p.auto_runs as { plan_id: string } | null)?.plan_id === planId && mine.length < RECENT_FOR_AI) mine.push(p.body);
  }
  return { bySns, mine };
}

// 文の材料（設計・プロジェクト）。持ち主のプロジェクトでなければ null
async function loadContext(admin: Db, projectId: string, ownerId: string, sns: SnsKey[]) {
  const { data: project } = await admin.from("projects").select("*").eq("id", projectId).eq("owner_id", ownerId).maybeSingle();
  if (!project) return null;
  const { data: planRow } = await admin.from("account_plans").select("data").eq("project_id", projectId).maybeSingle();
  const planData: PlanData = normalizePlan(planRow?.data, project.target_audience ?? "");
  const ctx = {
    project: { name: project.name, description: project.description ?? "", targetAudience: project.target_audience ?? "", productType: productTypeOf(project.product_type) },
    plan: planData,
    sns,
    voice: await loadVoiceContext(admin, projectId, planData.voice),
  };
  return { project: project as ProjectRow & { name: string }, planData, ctx };
}

export type Draft = { ok: true; texts: Texts; tags: Partial<Record<SnsKey, string[]>>; material: Material; ref: Record<string, unknown>; hold: Issue | null } | { ok: false; reason: AutoRunReason; detail: string; ref?: Record<string, unknown> };

// 材料を選び、文を作り、チェックする（見本と回の作成で同じ道）。投稿は作らない
export async function draftRun(
  admin: Db,
  deps: EngineDeps,
  args: { plan: AutoPlan & { ownerId: string }; sns: SnsKey[]; dueAt: Date; past: PastRef[]; recent: { bySns: Partial<Record<SnsKey, string[]>>; mine: string[] } },
): Promise<Draft> {
  const loaded = await loadContext(admin, args.plan.projectId, args.plan.ownerId, args.sns);
  if (!loaded) return { ok: false, reason: "error", detail: "プロジェクトが見つかりません" };
  const material = await pickMaterial(admin, { plan: args.plan, planData: loaded.planData, project: loaded.project, past: args.past, dueAt: args.dueAt }, deps);
  if (isNoMaterial(material)) return { ok: false, reason: material.reason, detail: material.detail };
  const ref: Record<string, unknown> = { ...material.ref };

  let texts: Texts;
  let hold: Issue | null = null;
  if (material.fixedTexts) {
    texts = { ...material.fixedTexts };
  } else {
    const out = await deps.generator({
      ownerId: args.plan.ownerId,
      kind: args.plan.kind,
      sns: args.sns,
      material: material.text,
      materialLabel: material.label,
      context: ideaContextText(loaded.ctx),
      tone: args.plan.tone,
      recentBodies: args.recent.mine,
      maxLength: Object.fromEntries(args.sns.map((s) => [s, SNS[s].maxLength ?? 10_000])),
    });
    // 書けなかった材料は、回の記録に残す（次の回は次の柱・行き先・メモへ進む。同じ材料を選び続けない）。AI の枠・失敗はそのまま（同じ材料でやり直す）
    if (!out.ok)
      return out.reason === "cannot_write"
        ? { ok: false, reason: "cannot_write", detail: out.detail, ref }
        : { ok: false, reason: out.reason === "ai_limit" ? "ai_limit" : "error", detail: out.detail };
    texts = out.texts;
    if (out.pillar) ref.pillar = out.pillar;
    if (out.concern) ref.concern = out.concern;
    hold = out.issues?.[0] ?? null;
  }

  // 長すぎるものは縮める（自動の投稿の枠で数える）
  const over = (Object.entries(texts) as [SnsKey, string][]).filter(([k, t]) => overLimit(k, t) > 0);
  if (over.length && deps.callShorten) {
    const call = budgeted(admin, { userId: args.plan.ownerId, purpose: "auto_post", call: "shorten" }, deps.callShorten);
    const { texts: short } = await shortenOverDrafts(call, over.map(([sns, text]) => ({ id: sns, sns, text })));
    for (const [id, t] of short) texts[id as SnsKey] = t;
  }

  const checkArgs = { allowedUrls: material.allowedUrls, recent: args.recent.bySns };
  hold ??= plainIssues(texts, checkArgs)[0] ?? null;
  if (!hold) {
    // AI っぽさチェック（自動の投稿の枠。用途 auto_post_check）
    const checkTexts: CheckText[] = dedupeTexts((Object.entries(texts) as [SnsKey, string][]).map(([sns, text]) => ({ sns, text })));
    const request = buildAiCheckRequest(
      {
        projectName: loaded.ctx.project.name,
        plan: loaded.planData,
        productType: loaded.ctx.project.productType,
        sns: args.sns,
        voice: loaded.ctx.voice,
        // 利用者が書いた事実（プロジェクトの説明・届けたい相手・この回の材料）。ここにあることは「事実か確かめて」にしない
        facts: { description: loaded.ctx.project.description, audience: loaded.ctx.project.targetAudience, material: material.text },
      },
      checkTexts,
    );
    const b = await withAiBudget(admin, { userId: args.plan.ownerId, purpose: "auto_post_check", call: "ai_check" }, request, deps.callCheck);
    // 確かめられないものは送らない
    if (!b.ok) return { ok: false, reason: "ai_limit", detail: b.message };
    const result = b.result.stopReason === "end_turn" ? normalizeAiCheck(b.result.output, checkTexts) : null;
    if (!result) hold = { kind: "check_failed", detail: "送る前の確かめが、うまくいきませんでした" };
    else {
      const applied = applyAiCheck(texts, result);
      hold = applied.hold;
      if (!hold && applied.fixed) {
        texts = applied.texts;
        ref.fixed = applied.fixed;
        hold = plainIssues(texts, checkArgs)[0] ?? null;
      }
    }
  }
  return { ok: true, texts, tags: material.fixedTags ?? {}, material, ref, hold };
}

async function processRun(admin: Db, deps: EngineDeps, run: ClaimedRun, now: Date): Promise<AutoRunStatus> {
  const { data: row } = await admin.from("auto_plans").select("*").eq("id", run.plan_id).eq("owner_id", run.owner_id).maybeSingle();
  if (!row || row.status !== "active") {
    await finish(admin, run.id, { status: "canceled", reason: "plan_paused" });
    return "canceled";
  }
  const plan = { ...toPlan(row), ownerId: run.owner_id };
  const due = new Date(run.due_at);

  // 送れる SNS: つないでいる（手で投稿の SNS はつながなくてよい）、その日の本数の上限の内
  const accounts = await connectedAccounts(admin, plan.projectId, plan.ownerId);
  const wanted = Object.keys(plan.targets) as SnsKey[];
  const connected = wanted.filter((s) => isManualSns(s) || accounts[s]);
  if (!connected.length) {
    await finish(admin, run.id, { status: "skipped", reason: "disconnected", detail: `${labels(wanted)} のつながりが切れています` });
    return "skipped";
  }
  const counts = await autoCountsOnDay(admin, plan.ownerId, due, run.id);
  let sns = connected.filter((s) => (counts[s] ?? 0) < DAILY_PER_SNS);
  if (!sns.length) {
    await finish(admin, run.id, { status: "skipped", reason: "daily_limit" });
    return "skipped";
  }

  const { data: pastRows } = await admin
    .from("auto_runs")
    .select("material_ref")
    .eq("plan_id", plan.id)
    .neq("id", run.id)
    .in("status", PAST_STATUSES)
    .order("due_at", { ascending: false })
    .limit(20);
  const past = (pastRows ?? []).map((r) => (r.material_ref ?? {}) as PastRef);
  const recent = await recentTexts(admin, plan.projectId, plan.ownerId, plan.id, now);
  const draft = await draftRun(admin, deps, { plan, sns, dueAt: due, past, recent });
  if (!draft.ok) {
    await finish(admin, run.id, { status: "skipped", reason: draft.reason, detail: draft.detail, ref: draft.ref });
    return "skipped";
  }
  // Instagram は画像が要る（段階 A はネタ帳の写真だけ）。写真がなければ Instagram は外す
  const photo = draft.material.noteIds?.length ? (await admin.from("media_files").select("id").in("note_id", draft.material.noteIds).eq("kind", "image").limit(1)).data?.length : 0;
  if (!photo) sns = sns.filter((s) => s !== "instagram");
  if (!sns.length) {
    await finish(admin, run.id, { status: "skipped", reason: "no_material", detail: "Instagram に添える写真がありません" });
    return "skipped";
  }

  const status: AutoRunStatus = draft.hold ? "held" : plan.firstReview ? "review" : "scheduled";
  const body = draft.texts[sns[0]]!;
  const { data: post, error } = await admin
    .from("posts")
    .insert({ project_id: plan.projectId, owner_id: plan.ownerId, body, status: status === "scheduled" ? "scheduled" : "draft", planned_at: due.toISOString(), text_origin: "ai", auto_run_id: run.id })
    .select("id")
    .single();
  if (error) throw error;
  const targets = sns.map((s) => ({
    post_id: post.id,
    owner_id: plan.ownerId,
    sns: s,
    social_account_id: isManualSns(s) ? null : (accounts[s] ?? null),
    body_override: draft.texts[s] !== body ? (draft.texts[s] ?? null) : null,
    hashtags: draft.tags[s] ?? [],
    status: plan.targets[s] === "review" ? "awaiting_approval" : "pending",
  }));
  const { error: e2 } = await admin.from("post_targets").insert(targets);
  if (e2) throw e2;

  if (draft.material.noteIds?.length) {
    await copyNoteImagesToPost(admin, plan.ownerId, post.id, draft.material.noteIds);
    await admin.from("idea_notes").update({ used_at: now.toISOString(), post_id: post.id }).in("id", draft.material.noteIds).eq("owner_id", plan.ownerId).is("used_at", null);
  }
  if (draft.material.series) {
    const s = draft.material.series;
    const { error: e3 } = await admin.from("post_format_rounds").insert({ format_id: s.formatId, owner_id: plan.ownerId, post_id: post.id, answer: s.answer, values: s.values, source: "ai" });
    if (e3) console.error("[auto-post] シリーズの記録を残せませんでした", e3.message);
  }
  await finish(admin, run.id, { status, postId: post.id, ref: draft.ref, reason: draft.hold?.kind ?? null, detail: draft.hold?.detail ?? null });
  return status;
}

export async function makeDueRuns(admin: Db, deps: EngineDeps, now: Date, opts: EngineOpts = {}): Promise<Partial<Record<AutoRunStatus, number>>> {
  const { data: runs, error } = await admin.rpc("claim_due_auto_runs", { p_limit: opts.limit ?? 5, ...(opts.ownerIds ? { p_owner_ids: opts.ownerIds } : {}) });
  if (error) throw error;
  const made: Partial<Record<AutoRunStatus, number>> = {};
  for (const run of runs ?? []) {
    let status: AutoRunStatus;
    try {
      status = await processRun(admin, deps, run, now);
    } catch (e) {
      console.error("[auto-post] 回を作れませんでした", run.id, e instanceof Error ? e.message : e);
      await finish(admin, run.id, { status: "skipped", reason: "error" }).catch(() => undefined);
      status = "skipped";
    }
    made[status] = (made[status] ?? 0) + 1;
  }
  return made;
}

// ===== ④ 回し方の状態を見直す =====
// 続けての失敗（送れなかった・下書きに回した）が 2 回、材料切れが 3 回、つながりが全部切れた、のどれかで止める（2.7）。
// 止めたら、作り終えてまだ送っていない予約を下書きに戻し、知らせる

type Outcome = "good" | "bad" | "no_material" | "disconnected" | "neutral" | "pending";

async function runOutcomes(admin: Db, planId: string, now: Date): Promise<Outcome[]> {
  const { data, error } = await admin
    .from("auto_runs")
    .select("status, reason, due_at, posts!auto_runs_post_id_fkey(post_targets(status))")
    .eq("plan_id", planId)
    .in("status", ["scheduled", "held", "skipped"])
    .lte("generate_at", now.toISOString())
    .order("due_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return data.map((r) => {
    if (r.status === "held") return "bad";
    if (r.status === "skipped") return r.reason === "no_material" ? "no_material" : r.reason === "disconnected" ? "disconnected" : "neutral";
    if (new Date(r.due_at).getTime() > now.getTime() - SETTLE_AFTER_MS) return "pending";
    const ts = ((r.posts as { post_targets: { status: string }[] } | null)?.post_targets ?? []).map((t) => t.status);
    if (ts.includes("published")) return "good";
    if (ts.length && ts.every((s) => s === "failed")) return "bad";
    return "neutral";
  });
}

function streak(outcomes: Outcome[], kind: Outcome): number {
  let n = 0;
  for (const o of outcomes) {
    if (o === "pending" || o === "neutral") continue;
    if (o !== kind) break;
    n++;
  }
  return n;
}

export async function reviewPlans(admin: Db, deps: EngineDeps, now: Date, opts: EngineOpts = {}): Promise<number> {
  const { data: plans, error } = await scope(admin.from("auto_plans").select("id, owner_id, project_id, name, fail_streak").eq("status", "active"), opts);
  if (error) throw error;
  let stopped = 0;
  for (const p of plans) {
    const outcomes = await runOutcomes(admin, p.id, now);
    const bad = streak(outcomes, "bad");
    const reason: AutoStopReason | null =
      bad >= FAIL_STREAK_STOP ? "fail_streak" : streak(outcomes, "no_material") >= MATERIALS_OUT_STOP ? "materials_out" : outcomes.find((o) => o !== "pending" && o !== "neutral") === "disconnected" ? "disconnected" : null;
    if (!reason) {
      if (bad !== p.fail_streak) await admin.from("auto_plans").update({ fail_streak: bad }).eq("id", p.id);
      continue;
    }
    const { data: changed } = await admin
      .from("auto_plans")
      .update({ status: "stopped", stop_reason: reason, fail_streak: bad, updated_at: now.toISOString() })
      .eq("id", p.id)
      .eq("status", "active")
      .select("id");
    if (!changed?.length) continue;
    stopped++;
    await stopUnsent(admin, p.id, now);
    await notify(admin, deps, p.owner_id, { title: "自動の投稿を止めました", body: `「${p.name}」: ${STOP_REASON_TEXT[reason]}`, url: `/projects/${p.project_id}/auto`, tag: `auto-stop:${p.id}` });
  }
  return stopped;
}

// 止めた回し方の、まだ作っていない回を止め、作り終えてまだ何も送っていない投稿を下書きに戻す
async function stopUnsent(admin: Db, planId: string, now: Date) {
  const { data: runs } = await admin.from("auto_runs").select("id, status, post_id").eq("plan_id", planId).gt("due_at", now.toISOString()).in("status", ["waiting", "scheduled", "review"]);
  for (const r of runs ?? []) {
    if (r.post_id) {
      const { data: ts } = await admin.from("post_targets").select("status").eq("post_id", r.post_id);
      if ((ts ?? []).some((t) => !["pending", "awaiting_approval"].includes(t.status))) continue;
      await admin.from("posts").update({ status: "draft" }).eq("id", r.post_id);
    }
    await admin.from("auto_runs").update({ status: "canceled", reason: "plan_paused", updated_at: now.toISOString() }).eq("id", r.id);
  }
}

// ===== ⑤ 知らせる（本文は入れない。送り先の SNS と時刻だけ） =====

async function pushAllowed(admin: Db, userId: string): Promise<boolean> {
  const { data } = await admin.from("notification_prefs").select("auto_post_push").eq("user_id", userId).maybeSingle();
  return data?.auto_post_push ?? true;
}

async function notify(admin: Db, deps: EngineDeps, userId: string, msg: PushMessage) {
  try {
    if (!(await pushAllowed(admin, userId))) return;
    await (deps.push ?? ((a, u, m) => sendPush(a, u, m)))(admin, userId, msg);
  } catch (e) {
    console.error("[auto-post] 知らせを送れませんでした", e instanceof Error ? e.message : e);
  }
}

type NotifyRow = { id: string; owner_id: string; project_id: string; due_at: string; status: string; posts: { post_targets: { sns: string; status: string }[] } | null };

// 1 人に 1 通にまとめる文（テストで中身を確かめる）
export function generatedMessage(rows: Pick<NotifyRow, "due_at" | "status" | "posts">[]): { title: string; body: string } {
  const waiting = rows.filter((r) => r.status === "review" || (r.posts?.post_targets ?? []).some((t) => t.status === "awaiting_approval"));
  const held = rows.filter((r) => r.status === "held");
  if (rows.length === 1) {
    const r = rows[0];
    const sns = (r.posts?.post_targets ?? []).map((t) => t.sns as SnsKey);
    const at = jstHm(new Date(r.due_at));
    if (r.status === "held") return { title: "自動の投稿を下書きに回しました", body: `${at} の回（${labels(sns)}）。確かめてから予約してください` };
    if (r.status === "review") return { title: "自動の投稿: 最初の回を確かめてください", body: `${at} に ${labels(sns)} に送ります。確かめるまで送りません` };
    const review = (r.posts?.post_targets ?? []).filter((t) => t.status === "awaiting_approval").map((t) => t.sns as SnsKey);
    return { title: "自動の投稿を予約しました", body: `${at} に ${labels(sns)} に送ります${review.length ? `（${labels(review)} は確かめが要ります）` : ""}` };
  }
  return { title: "自動の投稿を予約しました", body: `${rows.length} 件を作りました${waiting.length ? `（確かめ待ち ${waiting.length} 件）` : ""}${held.length ? `（下書きに回した ${held.length} 件）` : ""}` };
}

export async function notifyMade(admin: Db, deps: EngineDeps, now: Date, opts: EngineOpts = {}): Promise<number> {
  const { data, error } = await scope(
    admin
      .from("auto_runs")
      .select("id, owner_id, project_id, due_at, status, posts!auto_runs_post_id_fkey(post_targets(sns, status))")
      .is("notified_at", null)
      .in("status", ["scheduled", "review", "held"])
      .not("post_id", "is", null),
    opts,
  );
  if (error) throw error;
  const byOwner = new Map<string, NotifyRow[]>();
  for (const r of data as NotifyRow[]) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r]);
  for (const [owner, rows] of byOwner) {
    const msg = generatedMessage(rows);
    await notify(admin, deps, owner, { ...msg, url: `/projects/${rows[0].project_id}/auto`, tag: `auto-made:${owner}` });
    await admin.from("auto_runs").update({ notified_at: now.toISOString() }).in("id", rows.map((r) => r.id));
  }
  return byOwner.size;
}

// 確かめ待ちのまま、送る時刻の 2 時間前になった回をもう一度知らせる（1 回だけ）
export async function remindApprovals(admin: Db, deps: EngineDeps, now: Date, opts: EngineOpts = {}): Promise<number> {
  const { data, error } = await scope(
    admin
      .from("auto_runs")
      .select("id, owner_id, project_id, due_at, status, posts!auto_runs_post_id_fkey(post_targets(sns, status))")
      .is("reminded_at", null)
      .in("status", ["scheduled", "review"])
      .gt("due_at", now.toISOString())
      .lte("due_at", new Date(now.getTime() + REMIND_BEFORE_MS).toISOString()),
    opts,
  );
  if (error) throw error;
  let n = 0;
  for (const r of data as NotifyRow[]) {
    const waiting = (r.posts?.post_targets ?? []).filter((t) => t.status === "awaiting_approval").map((t) => t.sns as SnsKey);
    if (r.status !== "review" && !waiting.length) continue;
    const at = jstHm(new Date(r.due_at));
    await notify(admin, deps, r.owner_id, {
      title: "自動の投稿が確かめ待ちです",
      body: r.status === "review" ? `${at} の最初の回を、まだ確かめていません` : `${at} に ${labels(waiting)} に送る投稿を、まだ確かめていません`,
      url: `/projects/${r.project_id}/auto`,
      tag: `auto-remind:${r.id}`,
    });
    await admin.from("auto_runs").update({ reminded_at: now.toISOString() }).eq("id", r.id);
    n++;
  }
  return n;
}

// 本物の呼び出しをつないだ deps（ジョブと見本）。AI が使えなければ null
export function engineDeps(admin: Db): EngineDeps | null {
  const generator = autoPostGenerator(admin);
  if (!generator) return null;
  return { generator, callCheck: fakeAiMode() ? fakeCheck : callAiCheck, callShorten: callShortenDrafts };
}

// 偽の AI のときの AI っぽさチェック（指摘なし。費用は 0 として記録する）
const fakeCheck: CallCheck = async () => ({ output: { summary: "（偽の AI）", findings: [] }, stopReason: "end_turn", model: "fake", usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 } });

// 見本の 1 回（保存しない。材料は使ったことにしない）。文とチェックの結果を返す
export async function makeSample(admin: Db, deps: EngineDeps, args: { ownerId: string; projectId: string; plan: AutoPlan }): Promise<{ ok: true; texts: Texts; label: string; issues: Issue[] } | { ok: false; reason: AutoRunReason; detail: string }> {
  const plan = { ...args.plan, projectId: args.projectId, ownerId: args.ownerId };
  const sns = Object.keys(plan.targets) as SnsKey[];
  const { data: pastRows } = plan.id
    ? await admin.from("auto_runs").select("material_ref").eq("plan_id", plan.id).eq("owner_id", args.ownerId).in("status", PAST_STATUSES).order("due_at", { ascending: false }).limit(20)
    : { data: [] };
  const recent = await recentTexts(admin, args.projectId, args.ownerId, plan.id, new Date());
  const draft = await draftRun(admin, deps, { plan, sns, dueAt: new Date(Date.now() + 86_400_000), past: (pastRows ?? []).map((r) => (r.material_ref ?? {}) as PastRef), recent });
  if (!draft.ok) return draft;
  return { ok: true, texts: draft.texts, label: draft.material.label, issues: draft.hold ? [draft.hold] : [] };
}

// ===== ジョブの 1 回 =====
export async function runAutoPostJob(admin: Db, deps: EngineDeps, opts: EngineOpts = {}): Promise<JobSummary> {
  const now = deps.now?.() ?? new Date();
  const added = await addUpcomingRuns(admin, now, opts);
  const expired = await settleApprovals(admin, now, opts);
  const made = await makeDueRuns(admin, deps, now, opts);
  const stopped = await reviewPlans(admin, deps, now, opts);
  const notified = await notifyMade(admin, deps, now, opts);
  const reminded = await remindApprovals(admin, deps, now, opts);
  return { added, expired, made, stopped, notified, reminded };
}

