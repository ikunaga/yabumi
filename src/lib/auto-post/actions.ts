"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adoptSample, engineDeps, makeSample, makeSampleImage, NO_PLAN_ID } from "./engine";
import { MEDIA_BUCKET, PREVIEW_URL_SECONDS } from "@/lib/media/rules";
import { photoConfigured } from "@/lib/ai/gemini-image";
import { readFormatImage } from "@/lib/post-formats/image";
import { fakeAiMode } from "./ai";
import { fitImageToFormat } from "./format-image";
import { HOLD_REFUSED, myAutoPostHold } from "./holds";
import { getFormat } from "@/lib/post-formats/store";
import { X_FIXED_BODY, fixedBodySeries, isSeries, readPlanVars, seriesForPlan, undecidedPlanVars } from "@/lib/post-formats/series";
import { getAutoPlan, listProjectEvents, loadTargetPreviews } from "./queries";
import { autoPlanInputSchema, eventInputSchema, instructionSchema, instructionsSchema } from "./schema";
import type { AutoPlan, AutoPlanInput, AutoResult, AutoSample, ProjectEvent } from "./types";
import { LEGAL, orPending } from "@/lib/legal/info";

// 自動の投稿の操作（利用者の権限で。書き込みは DB の関数が確かめる。docs/design/auto-post.md、src/lib/auto-post/README.md）

type Db = Awaited<ReturnType<typeof createClient>>;

const BAD = "入力の形式が正しくありません。";
const FAILED = "うまくいきませんでした。時間をおいてもう一度お試しください。";

// DB の関数が返す決まった理由（hint）を、画面の文にする
const HINT_TEXT: Record<string, string> = {
  consent_required: "「AI が作った文を、確認せずに送ります」に同意してください。",
  legal_consent_missing: "利用規約とプライバシーポリシーに同意してから始めてください。",
  auto_plans_limit: "自動投稿は 1 つのプロジェクトに 10 個までです。使っていないものを消してください。",
  project_events_limit: "予定は 1 つのプロジェクトに 50 件までです。終わった予定を消してください。",
  approval_expired: "送る時刻を過ぎたので、送れません。投稿の画面で日時を直してから予約してください。",
  content_changed: "確認したあとに文が変わりました。もう一度確認してください。",
  // 過ぎてから 24 時間を過ぎた（20261129100000_auto_send_expired）
  expired_window_over: "送る時刻から 24 時間を過ぎたので、ここからは送れません。送るときは、「編集」を押して、日時を変えてから予約してください。",
  auto_plan_operator_stop: `yabumi の運営が、この自動投稿を止めています。再開・編集・削除はできません。くわしくは ${orPending(LEGAL.contact)} にお問い合わせください。`,
  // 運営者が利用者ごとに止めている（20261118100000_auto_post_holds）
  auto_post_hold: HOLD_REFUSED,
  // 予約済みの回を飛ばそうとしたが、もう送り始めていた（20261121110000）
  auto_run_sending: "もう送り始めているので、飛ばせません。",
  auto_instructions_invalid: "指示は 1 つ 100 字まで・8 個までです（1 行で書いてください）。",
  auto_image_invalid: "画像の設定が正しくありません。選び直してください。",
  ai_image_notice_missing: "AI の画像を使うには、先に AI の画像の注意を読んで「わかりました」を押してください。",
  // フォーマットの「自分で入れる」変数の決め方がそろっていない・変数が変わって止まった（20261121180000_format_variables）
  auto_format_vars_undecided: "フォーマットの変数が変わりました。画面を読み込み直して、変数の決め方を選び直してください。",
  auto_plan_format_changed: "フォーマットの変数が変わったので止めています。「編集」で変数の決め方を選び直して、保存してください。",
};

// 入力の確かめに通らなかったときの画面の文。schema に書いた日本語の文だけを出し、zod の既定の英語の文（知らないキー・型の違いなど）は
// 決まった文にして、詳しいことはログにだけ残す（2026-11-24 本番で「Unrecognized key: "format_var_modes"」がそのまま出た）
const JA = /[\u3040-\u30ff\u4e00-\u9fff]/;
function issueText(error: z.ZodError, where: string): string {
  const issue = error.issues[0];
  if (issue && JA.test(issue.message)) return issue.message;
  console.warn("[auto-post] 入力の確かめに通りませんでした", where, error.issues.map((i) => ({ code: i.code, path: i.path.join("."), message: i.message })));
  return BAD;
}

type DbError = { code?: string; hint?: string | null; message: string };

function errorText(e: DbError, notFound: string): string {
  if (e.hint && HINT_TEXT[e.hint]) return HINT_TEXT[e.hint];
  if (e.code === "P0002") return notFound;
  if (e.code === "22023") return BAD;
  console.error("[auto-post]", e.code, e.message);
  return FAILED;
}

async function signedIn(): Promise<Db | null> {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  return data?.claims?.sub ? db : null;
}

const uuid = z.uuid();
const SIGN_IN = { ok: false as const, error: "ログインし直してください。" };
const NO_PLAN = "自動投稿が見つかりません。画面を読み込み直してください。";
const NO_TARGET = "確認する投稿が見つかりません。画面を読み込み直してください。";

// 作る・直す（保存のたびに同意が要る。直したら、まだ作っていない回は新しい設定で作り直す）。保存した id を返す。
// 新しく作るときに sampleId があれば、その見本を最初の回にする（できなかったときは sampleNote に理由。回し方の保存はそのまま）
export async function saveAutoPlan(projectId: string, input: AutoPlanInput): Promise<AutoResult<{ id: string; sampleNote?: string; firstDueAt?: string }>> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: BAD };
  const p = autoPlanInputSchema.safeParse(input);
  if (!p.success) return { ok: false, error: issueText(p.error, "saveAutoPlan") };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const v = { ...p.data, image: await imageForFormat(db, projectId, p.data) };
  if (v.kind === "series" && v.materials.format_id) {
    const f = await getFormat(db, projectId, v.materials.format_id);
    if (f) {
      // 「自分で入れる」変数は、自動投稿での決め方をすべて選ぶ（決めていない変数を空のまま送らない。2026-11-21 オーナーの決定）
      const choices = readPlanVars(v.materials.format_vars);
      const undecided = undecidedPlanVars(f.series, choices);
      if (undecided.length) return { ok: false, error: `${undecided.map((n) => `{${n}}`).join("・")} の決め方を選んでください。` };
      const { series } = seriesForPlan(f.series, choices);
      if (!isSeries(series)) return { ok: false, error: "毎回同じ投稿になるので、このままでは送れません。どれか 1 つの変数を「自動投稿では AI に考えてもらう」にしてください。" };
      // 本文が毎回同じシリーズは X に送れない（画面でも選べない。2026-11-20 PM の指示）
      if (v.targets.x && fixedBodySeries(f.body, series)) return { ok: false, error: `${X_FIXED_BODY}X を選ばずに保存してください。` };
      v.materials = { ...v.materials, format_vars: Object.fromEntries(Object.entries(choices).filter(([k]) => f.series.vars.some((x) => x.name === k && x.mode === "hand"))) };
    }
  }
  const { data, error } = await db.rpc("save_auto_plan", {
    p_plan_id: (v.id ?? null) as string,
    p_project_id: projectId,
    p_name: v.name,
    p_kind: v.kind,
    p_materials: v.materials,
    p_targets: v.targets,
    p_x_link: v.xLink,
    p_schedule: v.schedule,
    p_instructions: v.instructions,
    p_image: v.image ?? {},
    p_lead_hours: v.leadHours,
    p_consent: v.consent,
  });
  if (error) return { ok: false, error: errorText(error, NO_PLAN) };
  const id = data as string;
  if (!v.sampleId || v.id) return { ok: true, data: { id } };
  // 見本を最初の回にする（サーバーの権限で、本人の見本と、いま保存した回し方だけ）
  const { data: claims } = await db.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: true, data: { id } };
  try {
    const r = await adoptSample(createAdminClient(), { ownerId: userId, planId: id, sampleId: v.sampleId });
    return r.ok ? { ok: true, data: { id, firstDueAt: r.dueAt } } : { ok: true, data: { id, sampleNote: `${r.detail}。1 回目の投稿は、いつもどおり送る前に作ってお知らせします。` } };
  } catch (e) {
    console.error("[auto-post] 見本を最初の回にできませんでした", e instanceof Error ? e.message : e);
    return { ok: true, data: { id, sampleNote: "テストでつくった投稿を 1 回目にできませんでした。1 回目は、いつもどおり送る前に作ってお知らせします。" } };
  }
}

// シリーズの回の画像を、いまのフォーマットの画像の設定に合わせる（画面と同じ fitImageToFormat。画面が古いままでも、保存はフォーマットのとおり）。
// フォーマットは利用者の権限で読む（見えなければ、そのまま。DB の save_auto_plan がフォーマットを確かめる）
async function imageForFormat(db: Db, projectId: string, v: AutoPlanInput): Promise<AutoPlanInput["image"]> {
  if (v.kind !== "series" || !v.materials.format_id) return v.image;
  const { data } = await db.from("post_formats").select("image").eq("id", v.materials.format_id).eq("project_id", projectId).maybeSingle();
  if (!data) return v.image;
  const img = readFormatImage(data.image);
  return fitImageToFormat(v.kind, { hasImage: !!img, hasHeadline: !!img?.headline }, v.image, photoConfigured() || !!fakeAiMode());
}

// 書き方の指示だけを直す（回し方の画面の見本から。同意の取り直しはしない）。直したあとの一覧を返す
export async function setAutoPlanInstructions(planId: string, instructions: string[]): Promise<AutoResult<string[]>> {
  if (!uuid.safeParse(planId).success) return { ok: false, error: BAD };
  const p = instructionsSchema.safeParse(instructions);
  if (!p.success) return { ok: false, error: issueText(p.error, "setAutoPlanInstructions") };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const { data, error } = await db.rpc("set_auto_plan_instructions", { p_plan_id: planId, p_instructions: p.data });
  if (error) return { ok: false, error: errorText(error, NO_PLAN) };
  return { ok: true, data: Array.isArray(data) ? (data as unknown[]).filter((x): x is string => typeof x === "string") : p.data };
}

// 止める（paused）・再開する（active）。止めるとき toDraft なら、作り終えてまだ送っていない予約を下書きに戻す（false ならそのまま送る）
export async function setAutoPlanStatus(projectId: string, planId: string, status: "active" | "paused", toDraft = true): Promise<AutoResult> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(planId).success || !["active", "paused"].includes(status)) return { ok: false, error: BAD };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const { error } = await db.rpc("set_auto_plan_status", { p_project_id: projectId, p_plan_id: planId, p_status: status, p_to_draft: toDraft });
  return error ? { ok: false, error: errorText(error, NO_PLAN) } : { ok: true, data: undefined };
}

// 全部止める（プロジェクトの自動の投稿をすべて止める）。止めた数を返す
export async function pauseAllAutoPlans(projectId: string, toDraft = true): Promise<AutoResult<{ count: number }>> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: BAD };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const { data, error } = await db.rpc("set_auto_plan_status", { p_project_id: projectId, p_plan_id: null as unknown as string, p_status: "paused", p_to_draft: toDraft });
  return error ? { ok: false, error: errorText(error, NO_PLAN) } : { ok: true, data: { count: Number(data ?? 0) } };
}

// 次の回を飛ばす。飛ばした回の時刻を返す（次の回がまだ決まっていなければ null）
export async function skipNextAutoRun(planId: string): Promise<AutoResult<{ dueAt: string | null }>> {
  if (!uuid.safeParse(planId).success) return { ok: false, error: BAD };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const { data, error } = await db.rpc("skip_next_auto_run", { p_plan_id: planId });
  return error ? { ok: false, error: errorText(error, NO_PLAN) } : { ok: true, data: { dueAt: (data as string | null) ?? null } };
}

// 予約済み・確認待ちの回を、その日だけ飛ばす（予約済みの投稿の画面の「この日の投稿を飛ばす」。2026-11-21）。
// 回は飛ばした記録になり、投稿は下書きに戻る。送り始めた SNS があれば DB が断る
const NO_RUN = "飛ばせる投稿が見つかりません。送る時刻を過ぎたか、もう飛ばしています。画面を読み込み直してください。";
export async function skipScheduledAutoRun(runId: string): Promise<AutoResult<{ dueAt: string }>> {
  if (!uuid.safeParse(runId).success) return { ok: false, error: BAD };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const { data, error } = await db.rpc("skip_scheduled_auto_run", { p_run_id: runId });
  return error ? { ok: false, error: errorText(error, NO_RUN) } : { ok: true, data: { dueAt: data as string } };
}

// 消す。toDraft なら、作り終えてまだ送っていない予約を下書きに戻す（false ならふつうの予約として残り、送られる）
export async function deleteAutoPlan(planId: string, toDraft = true): Promise<AutoResult> {
  if (!uuid.safeParse(planId).success) return { ok: false, error: BAD };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const { error } = await db.rpc("delete_auto_plan", { p_plan_id: planId, p_to_draft: toDraft });
  return error ? { ok: false, error: errorText(error, NO_PLAN) } : { ok: true, data: undefined };
}

// ===== 確かめる =====
// 最初の回の確かめ（A3。AutoReviewItem の kind が first_review）は reviewAutoRun。送るなら、画面に出した配信先の指紋をすべて渡す
// （確かめて送る SNS もまとめて承認する）。確かめて送る SNS の承認待ち（kind が approval）は approveAutoTarget・declineAutoTarget で SNS ごとに

const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);

export async function reviewAutoRun(runId: string, send: boolean, fingerprints: Record<string, string> = {}): Promise<AutoResult> {
  if (!uuid.safeParse(runId).success || !z.record(z.uuid(), fingerprint).safeParse(fingerprints).success) return { ok: false, error: BAD };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const { error } = await db.rpc("review_auto_run", { p_run_id: runId, p_send: send, p_fingerprints: fingerprints });
  return error ? { ok: false, error: errorText(error, NO_TARGET) } : { ok: true, data: undefined };
}

export async function approveAutoTarget(targetId: string, fp: string): Promise<AutoResult> {
  if (!uuid.safeParse(targetId).success || !fingerprint.safeParse(fp).success) return { ok: false, error: BAD };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const { error } = await db.rpc("approve_auto_target", { p_target_id: targetId, p_fingerprint: fp });
  return error ? { ok: false, error: errorText(error, NO_TARGET) } : { ok: true, data: undefined };
}

// 確認できないまま送る時刻を過ぎた配信先を、今すぐ送る（過ぎてから 24 時間まで。見た中身の指紋と同じときだけ。DB の send_expired_auto_target）
export async function sendExpiredAutoTarget(targetId: string, fp: string): Promise<AutoResult> {
  if (!uuid.safeParse(targetId).success || !fingerprint.safeParse(fp).success) return { ok: false, error: BAD };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const { error } = await db.rpc("send_expired_auto_target", { p_target_id: targetId, p_fingerprint: fp });
  return error ? { ok: false, error: errorText(error, NO_TARGET) } : { ok: true, data: undefined };
}

export async function declineAutoTarget(targetId: string): Promise<AutoResult> {
  if (!uuid.safeParse(targetId).success) return { ok: false, error: BAD };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const { error } = await db.rpc("decline_auto_target", { p_target_id: targetId });
  return error ? { ok: false, error: errorText(error, NO_TARGET) } : { ok: true, data: undefined };
}

// 投稿の、配信先ごとの送る中身と指紋（確かめる画面を開き直したとき）
export async function loadAutoTargetPreviews(postId: string) {
  if (!uuid.safeParse(postId).success) return { ok: false as const, error: BAD };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  try {
    return { ok: true as const, data: await loadTargetPreviews(db, postId) };
  } catch (e) {
    console.error("[auto-post]", e instanceof Error ? e.message : e);
    return { ok: false as const, error: FAILED };
  }
}

// ===== 見本の 1 回（保存しない） =====
// 次の回と同じ道（材料を選ぶ → AI が作る → チェック）で 1 回分を作って見せる。AI を 1〜2 回使う（自動の投稿の枠）。材料は使ったことにしない
// opts.oneTime: その 1 回だけの指示（覚えない）。opts.fromSampleId: 前の見本と同じ材料で作る（サーバーに置いた見本から読む）
export async function makeAutoSample(projectId: string, input: Omit<AutoPlanInput, "consent">, opts: { oneTime?: string; fromSampleId?: string } = {}): Promise<AutoResult<AutoSample>> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: BAD };
  const oneTime = opts.oneTime?.trim() ? instructionSchema.safeParse(opts.oneTime) : null;
  if (oneTime && !oneTime.success) return { ok: false, error: issueText(oneTime.error, "makeAutoSample.oneTime") };
  if (opts.fromSampleId !== undefined && !uuid.safeParse(opts.fromSampleId).success) return { ok: false, error: BAD };
  const p = autoPlanInputSchema.safeParse({ ...input, consent: true });
  if (!p.success) return { ok: false, error: issueText(p.error, "makeAutoSample") };
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return SIGN_IN;
  // 本人のプロジェクトか（ここから先はサーバーの権限で、持ち主とプロジェクトで絞って読む）
  const { data: project } = await db.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return { ok: false, error: "プロジェクトが見つかりません。" };
  // 運営者が止めている間は、見本も作らない（AI の予約 reserve_ai_usage でも断る）
  if (await myAutoPostHold(db)) return { ok: false, error: HOLD_REFUSED };
  const admin = createAdminClient();
  const deps = engineDeps(admin);
  if (!deps) return { ok: false, error: "「テストで 1 本つくる」は、まだ使えません。" };
  const v = p.data;
  const plan: AutoPlan = {
    id: v.id ?? "",
    projectId,
    name: v.name,
    kind: v.kind,
    materials: v.materials,
    targets: v.targets,
    xLink: v.xLink,
    schedule: v.schedule,
    instructions: v.instructions,
    image: v.image,
    leadHours: v.leadHours,
    firstReview: true,
    status: "active",
    stopReason: null,
    failStreak: 0,
    consentedAt: "",
    createdAt: "",
    updatedAt: "",
  };
  try {
    // 直すときは、本人の回し方か確かめる（ほかの人の回し方の記録を読ませない）
    if (v.id && !(await getAutoPlan(v.id))) return { ok: false, error: NO_PLAN };
    const r = await makeSample(admin, deps, {
      ownerId: userId,
      projectId,
      plan: v.id ? plan : { ...plan, id: NO_PLAN_ID },
      oneTime: oneTime?.success ? [oneTime.data] : undefined,
      fromSampleId: opts.fromSampleId,
    });
    if (!r.ok) {
      if (r.reason === "ai_limit") return { ok: false, error: r.detail || "今月の自動投稿の AI の枠を使い切りました。" };
      return { ok: true, data: { sampleId: null, texts: {}, materialLabel: "", issues: [{ kind: r.reason, detail: r.detail }] } };
    }
    const data: AutoSample = { sampleId: r.sampleId, texts: r.texts, tags: r.tags, materialLabel: r.label, issues: r.issues };
    // 画像の設定がある回し方は、文と一緒に画像（見出しを重ねる設定なら見出しも）をつくる。注意が出た見本でもつくる（本番でどう見えるかを確かめるため。
    // 2026-11-21 オーナーの決定）。つくれなかったら文だけ返し、imageFailed を付ける
    if (v.image && r.sampleId && Object.keys(r.texts).length > 0) {
      data.image = deps.image ? await sampleImage(admin, deps, { ownerId: userId, projectId, sampleId: r.sampleId }) : null;
      data.imageFailed = !data.image;
    }
    return { ok: true, data };
  } catch (e) {
    console.error("[auto-post] 見本を作れませんでした", e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
}

// 見本の画像をつくり、見る URL（1 時間で切れる）を付ける。つくれなかったら null（理由はサーバーの記録だけ）
async function sampleImage(admin: ReturnType<typeof createAdminClient>, deps: NonNullable<ReturnType<typeof engineDeps>>, args: { ownerId: string; projectId: string; sampleId: string }): Promise<AutoSample["image"]> {
  try {
    const r = await makeSampleImage(admin, deps, args);
    if (!r.ok) {
      console.error("[auto-post] 見本の画像をつくれませんでした", r.detail);
      return null;
    }
    const { data: url, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(r.image.path, PREVIEW_URL_SECONDS);
    if (error || !url) return null;
    return { url: url.signedUrl, width: r.image.width, height: r.image.height, alt: r.image.alt };
  } catch (e) {
    console.error("[auto-post] 見本の画像をつくれませんでした", e instanceof Error ? e.message : e);
    return null;
  }
}

// ===== お知らせ・季節の予定 =====
export async function listEvents(projectId: string): Promise<AutoResult<ProjectEvent[]>> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: BAD };
  if (!(await signedIn())) return SIGN_IN;
  try {
    return { ok: true, data: await listProjectEvents(projectId) };
  } catch (e) {
    console.error("[auto-post]", e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
}

// 足す（id なし）・直す（id あり）。保存した予定を返す
export async function saveEvent(projectId: string, input: { id?: string; onDate: string; body: string }): Promise<AutoResult<ProjectEvent>> {
  if (!uuid.safeParse(projectId).success || (input.id !== undefined && !uuid.safeParse(input.id).success)) return { ok: false, error: BAD };
  const p = eventInputSchema.safeParse(input);
  if (!p.success) return { ok: false, error: issueText(p.error, "saveEvent") };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const q = input.id
    ? db.from("project_events").update({ on_date: p.data.onDate, body: p.data.body }).eq("id", input.id).eq("project_id", projectId)
    : db.from("project_events").insert({ project_id: projectId, on_date: p.data.onDate, body: p.data.body });
  const { data, error } = await q.select("id, on_date, body").maybeSingle();
  if (error) return { ok: false, error: errorText(error, "予定が見つかりません。") };
  if (!data) return { ok: false, error: "予定が見つかりません。画面を読み込み直してください。" };
  return { ok: true, data: { id: data.id, onDate: data.on_date, body: data.body } };
}

export async function deleteEvent(projectId: string, id: string): Promise<AutoResult> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(id).success) return { ok: false, error: BAD };
  const db = await signedIn();
  if (!db) return SIGN_IN;
  const { error } = await db.from("project_events").delete().eq("id", id).eq("project_id", projectId);
  return error ? { ok: false, error: errorText(error, "予定が見つかりません。") } : { ok: true, data: undefined };
}

// 回し方を 1 つ読む（画面の担当が、直す画面を開くときに使う）
export async function loadAutoPlan(planId: string) {
  if (!uuid.safeParse(planId).success) return { ok: false as const, error: BAD };
  if (!(await signedIn())) return SIGN_IN;
  const plan = await getAutoPlan(planId);
  return plan ? { ok: true as const, data: plan } : { ok: false as const, error: NO_PLAN };
}
