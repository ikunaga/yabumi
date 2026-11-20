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
import { splitTagsByText, withHashtags } from "@/lib/sns/hashtags";
import type { Database } from "@/lib/supabase/database.types";
import { autoPostGenerator, fakeAiMode, type AutoPostGenerator } from "./ai";
import { callAiCheck, callShortenDrafts } from "@/lib/ai/anthropic";
import { applyAiCheck, isHardFinding, plainIssues, tagReserve, type Issue, type Texts } from "./checks";
export { tagReserve } from "./checks";
import { isNoMaterial, pickMaterial, type Material, type MaterialDeps, type PastRef, type ProjectRow } from "./materials";
import { readAutoImage, toPlan } from "./plan-row";
import { headlineSettingsSchema } from "@/lib/media/edit-schema";
import { dueTimes } from "./schedule";
import type { AutoPlan, AutoRunReason, AutoRunStatus, AutoStopReason } from "./types";
import { STOP_REASON_TEXT } from "./labels";
import { heldUserIds, HOLD_PUSH, isAutoPostHeld, RELEASE_PUSH } from "./holds";
import { attachImage, makeAutoImage, type AutoImageDeps, type MadeImage } from "./image";
import { callPhotoIdeas } from "@/lib/ai/anthropic";
import { generateWithGemini, photoConfigured, type GenerateImage } from "@/lib/ai/gemini-image";
import { photoModel } from "@/lib/ai/photo";

// 自動の投稿のジョブ（docs/design/auto-post.md の 2.3・2.7）。サーバーの権限（admin）で動くので、読むものは必ず持ち主とプロジェクトで絞る。
// 1 回の流れ: ① 14 日先までの回を足す → ② 送る時刻を過ぎた確かめ待ちを失敗にする・最初の回の確かめの後始末 → ③ 作る時刻が来た回を作る →
// ④ 回し方の状態（続けての失敗・材料切れ・つながり）を見直す → ⑤ 知らせる（作った・確かめ待ちの 2 時間前）→
// ⑥ 運営者が止めた・解除したことを知らせる。運営者が止めている人（auto_post_holds）は、①③⑤ から外す（DB の関数でも断る）

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
export const EXPIRED_MESSAGE = "確認できないまま送る時刻を過ぎたので、送りませんでした。送るときは、日時を直して確認してください。";
export const REVIEW_EXPIRED_DETAIL = "1 回目の投稿を確認しないまま、送る時刻を過ぎました";

export type EngineDeps = {
  generator: AutoPostGenerator;
  callCheck: CallCheck;
  callShorten?: CallShorten;
  push?: (admin: Db, userId: string, msg: PushMessage) => Promise<unknown>;
  now?: () => Date;
  // 自動の回の画像（docs/design/auto-sample-image.md の 2.）。ないとき（鍵がない）は、画像を選んだ回し方の回を下書きに回す
  image?: AutoImageDeps;
} & MaterialDeps;

// ownerIds: 結合テストで、テストの利用者だけを扱う（共有のローカル DB のほかの人の行に触らない）。ジョブは渡さない
export type EngineOpts = { ownerIds?: string[]; limit?: number };

export type JobSummary = { added: number; expired: number; made: Partial<Record<AutoRunStatus, number>>; stopped: number; notified: number; reminded: number; holdNotices: number };

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
  // 運営者が止めている人の回は足さない（解除したら、次のジョブで足す）
  const held = plans.length ? await heldUserIds(admin, [...new Set(plans.map((p) => p.owner_id))]) : new Set<string>();
  const until = new Date(now.getTime() + AHEAD_DAYS * 86_400_000);
  const rows = plans.filter((p) => !held.has(p.owner_id)).flatMap((p) =>
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
// 回し方を消すと auto_run_id は null になるので、消えない印（posts.auto_created）で拾う。
// 最初の回の確かめ（review）のまま過ぎた回は取り消す（投稿は下書きのまま残る）。利用者が投稿の画面で予約にした review の回は、確かめが済んだものとして扱う
export async function settleApprovals(admin: Db, now: Date, opts: EngineOpts = {}): Promise<number> {
  const { data: late, error } = await scope(
    admin.from("posts").select("id, post_targets!inner(id)").eq("auto_created", true).lte("planned_at", now.toISOString()).eq("post_targets.status", "awaiting_approval"),
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

export type Draft =
  | { ok: true; texts: Texts; tags: Partial<Record<SnsKey, string[]>>; material: Material; ref: Record<string, unknown>; hold: Issue | null; image?: MadeImage; headline?: string }
  | { ok: false; reason: AutoRunReason; detail: string; ref?: Record<string, unknown> };

// 画像を選んだ回し方なら、文のあとに画像を 1 枚つくる（確かめで引っかかった回はつくらない。費用をかけない）。
// つくれなければ、その回は下書きに回す（画像が前提の文が、画像なしで出ないように。Q5 の i）
async function withImage(admin: Db, deps: EngineDeps, plan: AutoPlan & { ownerId: string }, draft: Extract<Draft, { ok: true }>, sns: SnsKey[]): Promise<Extract<Draft, { ok: true }>> {
  if (!plan.image || draft.hold) return draft;
  const r = await makeAutoImage(admin, deps.image, { plan, texts: draft.texts, sns, material: draft.material, headline: draft.headline });
  return r.ok ? { ...draft, image: r.image } : { ...draft, hold: { kind: "image_failed", detail: r.detail } };
}

// 材料を選び、文を作り、チェックする（見本と回の作成で同じ道）。投稿は作らない
export async function draftRun(
  admin: Db,
  deps: EngineDeps,
  args: {
    plan: AutoPlan & { ownerId: string };
    sns: SnsKey[];
    dueAt: Date;
    past: PastRef[];
    recent: { bySns: Partial<Record<SnsKey, string[]>>; mine: string[] };
    // 見本: AI の用途（auto_post_sample）・その 1 回だけの指示・同じ材料で作り直すときの材料（前の見本のもの。サーバーに置いた行から）
    purpose?: "auto_post" | "auto_post_sample";
    extraInstructions?: string[];
    material?: Material;
  },
): Promise<Draft> {
  const loaded = await loadContext(admin, args.plan.projectId, args.plan.ownerId, args.sns);
  if (!loaded) return { ok: false, reason: "error", detail: "プロジェクトが見つかりません" };
  const material = args.material ?? (await pickMaterial(admin, { plan: args.plan, planData: loaded.planData, project: loaded.project, past: args.past, dueAt: args.dueAt }, deps));
  if (isNoMaterial(material)) return { ok: false, reason: material.reason, detail: material.detail };
  const purpose = args.purpose ?? "auto_post";
  const ref: Record<string, unknown> = { ...material.ref };
  // 本文とは別に付くタグ（シリーズのフォーマット → なければいつものタグ。materials.ts）。字数はタグの行の分を引いて書かせ、数えるときは足す（2026-11-17）
  const fixedTags = material.fixedTags ?? {};
  const reserveOf = (s: SnsKey) => tagReserve(s, fixedTags[s] ?? []);

  let texts: Texts;
  let hold: Issue | null = null;
  let headline: string | undefined;
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
      instructions: [...args.plan.instructions, ...(args.extraInstructions ?? [])],
      purpose,
      headline: args.plan.image?.headline === "ai",
      dueAt: args.dueAt,
      recentBodies: args.recent.mine,
      maxLength: Object.fromEntries(args.sns.map((s) => [s, Math.max(1, (SNS[s].maxLength ?? 10_000) - reserveOf(s))])),
      fixedTags,
    });
    // 書けなかった材料は、回の記録に残す（次の回は次の柱・行き先・メモへ進む。同じ材料を選び続けない）。AI の枠・失敗はそのまま（同じ材料でやり直す）
    if (!out.ok)
      return out.reason === "cannot_write"
        ? { ok: false, reason: "cannot_write", detail: out.detail, ref }
        : { ok: false, reason: out.reason === "ai_limit" ? "ai_limit" : "error", detail: out.detail };
    texts = out.texts;
    if (out.headline) headline = out.headline;
    if (out.pillar) ref.pillar = out.pillar;
    if (out.concern) ref.concern = out.concern;
    hold = out.issues?.[0] ?? null;
  }

  // 長すぎるものは縮める（自動の投稿の枠で数える）
  // 送る文（本文＋タグの行）で数え、縮める目標はタグの行の分を引く。
  // シリーズの本文（fixedTexts）は利用者が決めたフォーマットの文なので縮めない。超えるときは下書きに回す（2026-11-20 オーナーの本番の不具合）
  const over = (Object.entries(texts) as [SnsKey, string][]).filter(([k, t]) => overLimit(k, withHashtags(t, splitTagsByText(t, fixedTags[k] ?? []).keep)) > 0);
  if (over.length && material.fixedTexts) {
    hold ??= { kind: "too_long", detail: `フォーマットの文が長すぎて ${SNS[over[0][0]].label} に送れません。下書きに残しました。下書きを編集して、文を短くしてください。` };
  } else if (over.length && deps.callShorten) {
    const call = budgeted(admin, { userId: args.plan.ownerId, purpose, call: "shorten" }, deps.callShorten);
    const { texts: short } = await shortenOverDrafts(call, over.map(([sns, text]) => ({ id: sns, sns, text, reserve: reserveOf(sns) })));
    for (const [id, t] of short) texts[id as SnsKey] = t;
  }

  const checkArgs = { allowedUrls: material.allowedUrls, recent: args.recent.bySns, tags: fixedTags, skipSimilar: !!material.series?.fixedBody };
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
    if (!result) hold = { kind: "check_failed", detail: "送る前の確認が、うまくいきませんでした" };
    else {
      // シリーズの本文（fixedTexts）は利用者が決めたフォーマットの文なので、書き換えの案は当てない（数だけ記録する）。
      // 止める指摘（事実か確かめて・やらないこと）はいままでどおり hold にする（2026-11-20 オーナーの本番の不具合: 「答えはコメントで！」が「答えはリプで。」に変わった）
      const applied = material.fixedTexts ? { ...applyAiCheck(texts, { ...result, findings: result.findings.filter(isHardFinding) }), fixed: 0 } : applyAiCheck(texts, result);
      hold = applied.hold;
      if (material.fixedTexts) {
        const soft = result.findings.filter((f) => !isHardFinding(f)).length;
        if (!hold && soft) ref.suggested = soft;
      } else if (!hold && applied.fixed) {
        texts = applied.texts;
        ref.fixed = applied.fixed;
        hold = plainIssues(texts, checkArgs)[0] ?? null;
      }
    }
  }
  // 本文にもあるタグは、タグの行に付けない（2 回出さない。投稿をつくるの保存と同じ）
  const tags = Object.fromEntries((Object.entries(fixedTags) as [SnsKey, string[]][]).map(([s, t]) => [s, splitTagsByText(texts[s] ?? "", t).keep]));
  return { ok: true, texts, tags, material, ref, hold, ...(headline ? { headline } : {}) };
}

async function processRun(admin: Db, deps: EngineDeps, run: ClaimedRun, now: Date): Promise<AutoRunStatus> {
  const { data: row } = await admin.from("auto_plans").select("*").eq("id", run.plan_id).eq("owner_id", run.owner_id).maybeSingle();
  if (!row || row.status !== "active") {
    await finish(admin, run.id, { status: "canceled", reason: "plan_paused" });
    return "canceled";
  }
  // 取り出したあとに運営者が止めたとき（claim_due_auto_runs でも外している）
  if (await isAutoPostHeld(admin, run.owner_id)) {
    await finish(admin, run.id, { status: "canceled", reason: "operator_hold" });
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
  const sns = connected.filter((s) => (counts[s] ?? 0) < DAILY_PER_SNS);
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
  return placeDraft(admin, plan, { id: run.id, due }, await withImage(admin, deps, plan, draft, sns), sns, accounts, now);
}

// 作った文から、その回の投稿と配信先を作る（ジョブの回と「この見本を最初の回にする」で同じ道）。
// asReviewed: 利用者が見本を見て決めた回（最初の回の確かめ〈A3〉を済ませたことにする。確かめて送る SNS は、いつもどおり承認が要る）
async function placeDraft(
  admin: Db,
  plan: AutoPlan & { ownerId: string },
  run: { id: string; due: Date },
  draft: Extract<Draft, { ok: true }>,
  snsIn: SnsKey[],
  accounts: Partial<Record<SnsKey, string>>,
  now: Date,
  opts: { asReviewed?: boolean } = {},
): Promise<AutoRunStatus> {
  const due = run.due;
  let sns = snsIn.filter((s) => draft.texts[s]);
  // Instagram は画像が要る（ネタ帳の写真か、自動の回の画像）。どちらもなければ Instagram は外す
  const photo =
    !!draft.image ||
    (draft.material.noteIds?.length ? !!(await admin.from("media_files").select("id").in("note_id", draft.material.noteIds).eq("kind", "image").limit(1)).data?.length : false);
  if (!photo) sns = sns.filter((s) => s !== "instagram");
  if (!sns.length) {
    await finish(admin, run.id, { status: "skipped", reason: "no_material", detail: "Instagram に添える写真がありません" });
    return "skipped";
  }

  let hold = draft.hold;
  let status: AutoRunStatus = hold ? "held" : plan.firstReview && !opts.asReviewed ? "review" : "scheduled";
  const body = draft.texts[sns[0]]!;
  const { data: post, error } = await admin
    .from("posts")
    .insert({ project_id: plan.projectId, owner_id: plan.ownerId, body, status: status === "scheduled" ? "scheduled" : "draft", planned_at: due.toISOString(), text_origin: "ai", auto_run_id: run.id })
    .select("id")
    .single();
  if (error) throw error;
  // 画像は配信先を作る前に添える（確かめて送る SNS の指紋に画像が入る。添えられなければ、その回は下書きに回す）
  if (draft.image && !(await attachImage(admin, plan.ownerId, post.id, draft.image)) && status !== "held") {
    hold = { kind: "image_failed", detail: "画像を投稿に添えられませんでした" };
    status = "held";
    await admin.from("posts").update({ status: "draft" }).eq("id", post.id);
  }
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
  await finish(admin, run.id, { status, postId: post.id, ref: draft.ref, reason: hold?.kind ?? null, detail: hold?.detail ?? null });
  return status;
}

export async function makeDueRuns(admin: Db, deps: EngineDeps, now: Date, opts: EngineOpts = {}): Promise<Partial<Record<AutoRunStatus, number>>> {
  const { data: runs, error } = await admin.rpc("claim_due_auto_runs", { p_limit: opts.limit ?? 5, ...(opts.ownerIds ? { p_owner_ids: opts.ownerIds } : {}) });
  if (error) throw error;
  const made: Partial<Record<AutoRunStatus, number>> = {};
  // 送る時刻の早い回から作る。claim_due_auto_runs は送る時刻の順に選ぶが、update ... returning の返す順は決まっていない。
  // 同じ日の回が上限（1 日に SNS ごとに 2 本）を超えるとき、どの回を飛ばすかが返す順で変わっていた（2026-11-21。テストが時々落ちた原因）
  const ordered = [...(runs ?? [])].sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  for (const run of ordered) {
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
    // 画像をつくれなかった回は、続けての失敗に数えない（画像の AI の障害で回し方が止まらないように）
    if (r.status === "held") return r.reason === "image_failed" ? "neutral" : "bad";
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
    await notify(admin, deps, p.owner_id, { title: "自動投稿を止めました", body: `「${p.name}」: ${STOP_REASON_TEXT[reason]}`, url: `/projects/${p.project_id}/auto`, tag: `auto-stop:${p.id}` });
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
    if (r.status === "held") return { title: "自動投稿を下書きに残しました", body: `${at} に ${labels(sns)} に送る投稿です。確認してから予約してください` };
    if (r.status === "review") return { title: "自動投稿: 1 回目の投稿を確認してください", body: `${at} に ${labels(sns)} に送ります。確認するまで送りません` };
    const review = (r.posts?.post_targets ?? []).filter((t) => t.status === "awaiting_approval").map((t) => t.sns as SnsKey);
    return { title: "自動投稿を予約しました", body: `${at} に ${labels(sns)} に送ります${review.length ? `（${labels(review)} は確認が要ります）` : ""}` };
  }
  return { title: "自動投稿を予約しました", body: `${rows.length} 件を作りました${waiting.length ? `（確認待ち ${waiting.length} 件）` : ""}${held.length ? `（下書きに回した ${held.length} 件）` : ""}` };
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
  // 運営者が止めている人には、承認を促さない（承認は断られる）
  const rows = data as NotifyRow[];
  const held = rows.length ? await heldUserIds(admin, [...new Set(rows.map((r) => r.owner_id))]) : new Set<string>();
  let n = 0;
  for (const r of rows) {
    if (held.has(r.owner_id)) continue;
    const waiting = (r.posts?.post_targets ?? []).filter((t) => t.status === "awaiting_approval").map((t) => t.sns as SnsKey);
    if (r.status !== "review" && !waiting.length) continue;
    const at = jstHm(new Date(r.due_at));
    await notify(admin, deps, r.owner_id, {
      title: "自動投稿が確認待ちです",
      body: r.status === "review" ? `${at} に送る 1 回目の投稿を、まだ確認していません` : `${at} に ${labels(waiting)} に送る投稿を、まだ確認していません`,
      url: `/projects/${r.project_id}/auto`,
      tag: `auto-remind:${r.id}`,
    });
    await admin.from("auto_runs").update({ reminded_at: now.toISOString() }).eq("id", r.id);
    n++;
  }
  return n;
}

// 運営者が止めた・解除したことを、スマホの通知で 1 回ずつ知らせる（利用規約の「止めたときは画面と通知で知らせます」）。
// 文は決まったものだけで、理由は入れない。知らせる前に解除した回は、止めた知らせを飛ばす
export async function notifyHolds(admin: Db, deps: EngineDeps, now: Date, opts: EngineOpts = {}): Promise<number> {
  const at = now.toISOString();
  const { data: held, error } = await scope(admin.from("auto_post_holds").select("id, user_id").is("hold_notified_at", null).is("released_at", null), opts, "user_id");
  if (error) throw error;
  for (const h of held) {
    await notify(admin, deps, h.user_id, { ...HOLD_PUSH, url: "/projects", tag: `auto-hold:${h.id}` });
    await admin.from("auto_post_holds").update({ hold_notified_at: at }).eq("id", h.id);
  }
  const { data: released, error: e2 } = await scope(admin.from("auto_post_holds").select("id, user_id, hold_notified_at").is("release_notified_at", null).not("released_at", "is", null), opts, "user_id");
  if (e2) throw e2;
  for (const h of released) {
    if (h.hold_notified_at) await notify(admin, deps, h.user_id, { ...RELEASE_PUSH, url: "/projects", tag: `auto-hold:${h.id}` });
    await admin.from("auto_post_holds").update({ hold_notified_at: h.hold_notified_at ?? at, release_notified_at: at }).eq("id", h.id);
  }
  return held.length + released.filter((h) => h.hold_notified_at).length;
}

// 本物の呼び出しをつないだ deps（ジョブと見本）。AI が使えなければ null
export function engineDeps(admin: Db): EngineDeps | null {
  const generator = autoPostGenerator(admin);
  if (!generator) return null;
  const fake = !!fakeAiMode();
  const image: AutoImageDeps | undefined = fake
    ? { generate: fakeImage, model: photoModel(), callScene: fakeScene }
    : photoConfigured()
      ? { generate: generateWithGemini, model: photoModel(), callScene: callPhotoIdeas }
      : undefined;
  return { generator, callCheck: fake ? fakeCheck : callAiCheck, callShorten: callShortenDrafts, image };
}

// 偽の AI のときの画像（灰色の 800×1000 の 1 枚。見出しを重ねたのが見えるように）と場面。画面の確かめで、本物の AI を使わずに画像つきの回を見るため（Vercel の上では使わない。fakeAiMode）
const FAKE_JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAPoAyADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAEG/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABcBAQADAAAAAAAAAAAAAAAAAAABAgP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwDUiDFdRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogCiAKIAogAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/9k=";
const fakeImage: GenerateImage = async () => ({ bytes: Uint8Array.from(Buffer.from(FAKE_JPEG, "base64")), mimeType: "image/jpeg", inputTokens: 0 });
const fakeScene: AutoImageDeps["callScene"] = async () => ({
  output: { ideas: [{ title: "（偽の AI）", scene: "（偽の AI）木の机の上に、焙煎したコーヒー豆が広がっている", why: "" }] },
  stopReason: "end_turn",
  model: "fake",
  usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
});

// 偽の AI のときの AI っぽさチェック（指摘なし。費用は 0 として記録する）
const fakeCheck: CallCheck = async () => ({ output: { summary: "（偽の AI）", findings: [] }, stopReason: "end_turn", model: "fake", usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 } });

// ===== 見本（docs/design/auto-sample-image.md の 1.）=====
// 見本は auto_samples に 1 日だけ置く（画面には返事で見せ、画面から文は受け取らない）。材料は使ったことにしない。
// 置いた見本は「同じ材料で作り直す」と「この見本を最初の回にする」に使う

export const SAMPLE_TTL_MS = 86_400_000;

// 見本を作ったときの設定（最初の回にするとき、保存した回し方と同じかを確かめる）。並びをそろえて比べる
export function sampleSettings(plan: Pick<AutoPlan, "kind" | "materials" | "targets" | "xLink" | "instructions"> & { image?: AutoPlan["image"] }): Record<string, unknown> {
  const sort = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const materials = sort(plan.materials as Record<string, unknown>);
  if (Array.isArray(materials.destination_ids)) materials.destination_ids = [...(materials.destination_ids as string[])].sort();
  return { kind: plan.kind, materials, targets: sort(plan.targets as Record<string, unknown>), xLink: plan.xLink, instructions: plan.instructions, image: plan.image ?? null };
}
// DB（jsonb）はキーの並びを変えるので、キーを並べ直してから比べる
const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;
export const sameSettings = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export type SampleOutcome =
  | { ok: true; sampleId: string | null; texts: Texts; tags: Partial<Record<SnsKey, string[]>>; label: string; issues: Issue[] }
  | { ok: false; reason: AutoRunReason; detail: string };

// 見本の 1 回。oneTime はその 1 回だけの指示。fromSampleId なら、その見本（本人の、1 日以内の、同じプロジェクトのもの）と同じ材料で作る
export async function makeSample(
  admin: Db,
  deps: EngineDeps,
  args: { ownerId: string; projectId: string; plan: AutoPlan; oneTime?: string[]; fromSampleId?: string; now?: Date },
): Promise<SampleOutcome> {
  const now = args.now ?? new Date();
  const plan = { ...args.plan, projectId: args.projectId, ownerId: args.ownerId };
  const sns = Object.keys(plan.targets) as SnsKey[];
  let material: Material | undefined;
  if (args.fromSampleId) {
    const { data: prev } = await admin
      .from("auto_samples")
      .select("material")
      .eq("id", args.fromSampleId)
      .eq("owner_id", args.ownerId)
      .eq("project_id", args.projectId)
      .gt("created_at", new Date(now.getTime() - SAMPLE_TTL_MS).toISOString())
      .maybeSingle();
    // 見つからなければ（1 日たった・ほかの人の見本）材料を選び直す
    if (prev?.material) material = prev.material as unknown as Material;
  }
  const realId = !!plan.id && plan.id !== NO_PLAN_ID;
  const { data: pastRows } = realId
    ? await admin.from("auto_runs").select("material_ref").eq("plan_id", plan.id).eq("owner_id", args.ownerId).in("status", PAST_STATUSES).order("due_at", { ascending: false }).limit(20)
    : { data: [] };
  const recent = await recentTexts(admin, args.projectId, args.ownerId, plan.id, now);
  const draft = await draftRun(admin, deps, {
    plan,
    sns,
    dueAt: new Date(now.getTime() + 86_400_000),
    past: (pastRows ?? []).map((r) => (r.material_ref ?? {}) as PastRef),
    recent,
    purpose: "auto_post_sample",
    extraInstructions: args.oneTime,
    material,
  });
  if (!draft.ok) return draft;
  const issues = draft.hold ? [draft.hold] : [];
  const { data: row, error } = await admin
    .from("auto_samples")
    .insert({
      owner_id: args.ownerId,
      project_id: args.projectId,
      plan_id: realId ? plan.id : null,
      settings: sampleSettings(plan) as never,
      // AI が書いた見出しは、見本の画像をつくるときに使う（材料と一緒に持つ）
      material: { ...draft.material, ...(draft.headline ? { aiHeadline: draft.headline } : {}) } as never,
      texts: draft.texts as never,
      tags: draft.tags as never,
      hold: (draft.hold ?? null) as never,
    })
    .select("id")
    .single();
  // 置けなくても見本は見せる（同じ材料での作り直しと、最初の回にするのができないだけ）
  if (error) console.error("[auto-post] 見本を置けませんでした", error.message);
  return { ok: true, sampleId: row?.id ?? null, texts: draft.texts, tags: draft.tags, label: draft.material.label, issues };
}

// 回し方を保存する前の見本で使う、仮の回し方の id（auto_runs を読まない）
export const NO_PLAN_ID = "00000000-0000-0000-0000-000000000000";

export type AdoptOutcome = { ok: true; status: AutoRunStatus; dueAt: string } | { ok: false; detail: string };

// この見本を最初の回にする（新しく作った回し方だけ。Q8）。見本は 1 回だけ使える（使ったら消す）。
// 保存した回し方と、見本を作ったときの設定が同じで、確かめで引っかかっていない見本だけ。最初の送る時刻の回として投稿を作り、
// 最初の回の確かめ（A3）を済ませたことにする（利用者が見本を見て決めたため）。確かめて送る SNS は、いつもどおり承認が要る
export async function adoptSample(admin: Db, args: { ownerId: string; planId: string; sampleId: string; now?: Date }): Promise<AdoptOutcome> {
  const now = args.now ?? new Date();
  const { data: row } = await admin.from("auto_plans").select("*").eq("id", args.planId).eq("owner_id", args.ownerId).maybeSingle();
  if (!row || row.status !== "active") return { ok: false, detail: "自動投稿が見つかりません" };
  if (await isAutoPostHeld(admin, args.ownerId)) return { ok: false, detail: "yabumi の運営が自動投稿を止めています" };
  const plan = { ...toPlan(row), ownerId: args.ownerId };
  // 1 回だけ使う（同時に押されても 1 つの回にしかならない）
  const { data: samples, error } = await admin
    .from("auto_samples")
    .delete()
    .eq("id", args.sampleId)
    .eq("owner_id", args.ownerId)
    .eq("project_id", plan.projectId)
    .is("plan_id", null)
    .gt("created_at", new Date(now.getTime() - SAMPLE_TTL_MS).toISOString())
    .select("settings, material, texts, tags, hold, image");
  if (error) throw error;
  const sample = samples?.[0];
  if (!sample) return { ok: false, detail: "テストでつくった投稿は、1 日たったので消えました" };
  if (sample.hold) return { ok: false, detail: "テストでつくった投稿は、送る前の確認で注意が出たので、1 回目にしませんでした" };
  if (!sameSettings(sample.settings, sampleSettings(plan))) return { ok: false, detail: "テストでつくったあとに設定を変えたので、1 回目にしませんでした" };
  // 画像を選んだ回し方は、見本の画像も要る（画像なしの見本は、画像なしで出るものと同じではないため）
  const sampleImage = readSampleImage(sample.image);
  if (plan.image && !sampleImage) return { ok: false, detail: "テストでつくった投稿には画像がなかったので、1 回目にしませんでした" };

  const due = dueTimes(plan.schedule, now, new Date(now.getTime() + AHEAD_DAYS * 86_400_000))[0];
  if (!due) return { ok: false, detail: "最初の送る時刻が見つかりませんでした" };
  const accounts = await connectedAccounts(admin, plan.projectId, plan.ownerId);
  const wanted = Object.keys(plan.targets) as SnsKey[];
  const counts = await autoCountsOnDay(admin, plan.ownerId, due, NO_PLAN_ID);
  const sns = wanted.filter((s) => (isManualSns(s) || accounts[s]) && (counts[s] ?? 0) < DAILY_PER_SNS);
  if (!sns.length) return { ok: false, detail: "送れる SNS がありませんでした（つながり・1 日の本数）" };
  // その時刻の回をこの見本で作る。ジョブがもう「作る前の回」（waiting）を足していたら、それを使う
  const { data: inserted, error: e2 } = await admin
    .from("auto_runs")
    .insert({ plan_id: plan.id, owner_id: plan.ownerId, project_id: plan.projectId, due_at: due.toISOString(), generate_at: now.toISOString(), status: "generating", locked_at: now.toISOString() })
    .select("id")
    .maybeSingle();
  let run = inserted;
  if (e2) {
    if (e2.code !== "23505") throw e2;
    const { data: claimed, error: e3 } = await admin
      .from("auto_runs")
      .update({ status: "generating", locked_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("plan_id", plan.id)
      .eq("due_at", due.toISOString())
      .eq("status", "waiting")
      .select("id")
      .maybeSingle();
    if (e3) throw e3;
    run = claimed;
  }
  if (!run) return { ok: false, detail: "1 回目の投稿を、もう作り始めていました" };
  const material = sample.material as unknown as Material;
  const draft: Extract<Draft, { ok: true }> = {
    ok: true,
    texts: sample.texts as Texts,
    tags: (sample.tags ?? {}) as Partial<Record<SnsKey, string[]>>,
    material,
    ref: { ...material.ref, from_sample: true },
    hold: null,
    ...(plan.image && sampleImage ? { image: sampleImage } : {}),
  };
  const status = await placeDraft(admin, plan, { id: run.id, due }, draft, sns, accounts, now, { asReviewed: true });
  if (status === "scheduled") await admin.from("auto_plans").update({ first_review: false, updated_at: now.toISOString() }).eq("id", plan.id).eq("owner_id", plan.ownerId);
  return { ok: true, status, dueAt: due.toISOString() };
}

function readSampleImage(v: unknown): MadeImage | null {
  const r = (v ?? null) as Partial<MadeImage> | null;
  if (!(r && typeof r.path === "string" && typeof r.jobId === "string" && typeof r.width === "number" && typeof r.height === "number")) return null;
  const base = r.base && typeof r.base.path === "string" && typeof r.base.width === "number" && typeof r.base.height === "number" ? r.base : undefined;
  const headline = headlineSettingsSchema.safeParse(r.headline);
  return {
    path: r.path,
    jobId: r.jobId,
    width: r.width,
    height: r.height,
    alt: typeof r.alt === "string" ? r.alt : "",
    ...(base && headline.success ? { base: { path: base.path, width: base.width, height: base.height }, headline: headline.data as MadeImage["headline"] } : {}),
  };
}

// 見本の画像をつくる（「画像もつくる」を押したとき。文の作り直しとは別。docs/design/auto-sample-image.md の 2.1）。
// 本人の、1 日以内の、このプロジェクトの見本だけ。画像の設定と文は見本の行から読む（画面から受け取らない）
export async function makeSampleImage(
  admin: Db,
  deps: EngineDeps,
  args: { ownerId: string; projectId: string; sampleId: string; now?: Date },
): Promise<{ ok: true; image: MadeImage } | { ok: false; detail: string }> {
  const now = args.now ?? new Date();
  const { data: sample } = await admin
    .from("auto_samples")
    .select("settings, material, texts, hold, image")
    .eq("id", args.sampleId)
    .eq("owner_id", args.ownerId)
    .eq("project_id", args.projectId)
    .gt("created_at", new Date(now.getTime() - SAMPLE_TTL_MS).toISOString())
    .maybeSingle();
  if (!sample) return { ok: false, detail: "テストでつくった投稿は、1 日たったので消えました。もう一度つくってください" };
  const existing = readSampleImage(sample.image);
  if (existing) return { ok: true, image: existing };
  if (sample.hold) return { ok: false, detail: "注意が出た投稿なので、画像はつくりませんでした。テストで、もう一度つくってください" };
  const settings = sample.settings as { kind?: AutoPlan["kind"]; materials?: AutoPlan["materials"]; targets?: AutoPlan["targets"]; image?: AutoPlan["image"] };
  const image = readAutoImage(settings.image);
  if (!image) return { ok: false, detail: "画像の設定がありません" };
  const texts = (sample.texts ?? {}) as Texts;
  const sns = (Object.keys(settings.targets ?? {}) as SnsKey[]).filter((s) => texts[s]);
  const plan = { projectId: args.projectId, ownerId: args.ownerId, materials: settings.materials ?? {}, image } as AutoPlan & { ownerId: string };
  const material = sample.material as unknown as Material & { aiHeadline?: string };
  const r = await makeAutoImage(admin, deps.image, { plan, texts, sns, material, headline: material.aiHeadline });
  if (!r.ok) return r;
  await admin.from("auto_samples").update({ image: r.image as never }).eq("id", args.sampleId).eq("owner_id", args.ownerId);
  return { ok: true, image: r.image };
}

// 1 日たった見本を消す（ジョブの 1 回ごと）
export async function purgeSamples(admin: Db, now: Date, opts: EngineOpts = {}): Promise<number> {
  const { data, error } = await scope(admin.from("auto_samples").delete().lt("created_at", new Date(now.getTime() - SAMPLE_TTL_MS).toISOString()), opts).select("id");
  if (error) throw error;
  return data.length;
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
  const holdNotices = await notifyHolds(admin, deps, now, opts);
  await purgeSamples(admin, now, opts);
  return { added, expired, made, stopped, notified, reminded, holdNotices };
}

