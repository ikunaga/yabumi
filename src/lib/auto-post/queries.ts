import "server-only";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import { PREVIEW_URL_SECONDS } from "@/lib/media/rules";
import { signedUrls } from "@/lib/media/store";
import { signedVideoUrl } from "@/lib/media/video-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { myAutoPostHold } from "./holds";
import { dueTimes } from "./schedule";
import { toPlan, toRun, type PlanRow, type RunRow } from "./plan-row";
import { NO_MEDIA, type ReviewMedia } from "./review-media";
import type { AutoPlan, AutoReviewItem, AutoRun, AutoTargetPreview, ProjectEvent, UpcomingAutoRun } from "./types";

// 自動の投稿の読み取り（利用者の権限のクライアントで。RLS で本人のものだけ）。画面とカレンダー・概要から呼ぶ

type Db = Awaited<ReturnType<typeof createClient>>;

const PLAN_COLUMNS =
  "id, project_id, name, kind, materials, targets, x_link, schedule, instructions, image, lead_hours, first_review, status, stop_reason, fail_streak, consented_at, created_at, updated_at";
const RUN_COLUMNS = "id, plan_id, due_at, generate_at, status, post_id, reason, reason_detail";

async function db(): Promise<Db> {
  return createClient();
}

// 運営者が、本人の自動の投稿を止めているか（RLS で本人の行だけ。読めるのは日時だけ）。止めていなければ null
export async function getAutoPostHold(): Promise<{ heldAt: string } | null> {
  return myAutoPostHold(await db());
}

// プロジェクトの自動の回し方（作った順）
export async function listAutoPlans(projectId: string): Promise<AutoPlan[]> {
  const { data, error } = await (await db()).from("auto_plans").select(PLAN_COLUMNS).eq("project_id", projectId).order("created_at");
  if (error) throw new Error(`auto_plans: ${error.message}`);
  return (data as PlanRow[]).map(toPlan);
}

export async function getAutoPlan(planId: string): Promise<AutoPlan | null> {
  const { data, error } = await (await db()).from("auto_plans").select(PLAN_COLUMNS).eq("id", planId).maybeSingle();
  if (error) throw new Error(`auto_plans: ${error.message}`);
  return data ? toPlan(data as PlanRow) : null;
}

// もう作った、これから送る回（予約済み・1 回目の確認待ち）。編集しても、これらは前の設定のまま送る（save_auto_plan は作っていない回だけ作り直す）。
// 編集の保存のポップアップと、保存したあとの知らせで、いつの投稿から変わるかを出す（2026-11-21 オーナーの質問）
export type MadeAutoPost = { dueAt: string; postId: string };
export async function listMadeAutoPosts(planId: string, now: Date = new Date()): Promise<MadeAutoPost[]> {
  const { data, error } = await (await db())
    .from("auto_runs")
    .select("due_at, post_id")
    .eq("plan_id", planId)
    .in("status", ["scheduled", "review"])
    .not("post_id", "is", null)
    .gt("due_at", now.toISOString())
    .order("due_at");
  if (error) throw new Error(`auto_runs: ${error.message}`);
  return data.map((r) => ({ dueAt: r.due_at, postId: r.post_id! }));
}

// 回し方の回（新しい順。結果を見る画面）
export async function listAutoRuns(planId: string, limit = 50): Promise<AutoRun[]> {
  const { data, error } = await (await db())
    .from("auto_runs")
    .select(RUN_COLUMNS)
    .eq("plan_id", planId)
    .order("due_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw new Error(`auto_runs: ${error.message}`);
  return (data as RunRow[]).map(toRun);
}

// これからの自動の回（カレンダー・概要）。from〜until の間の、動いている回し方の回。
// ジョブがまだ作っていない回（14 日より先など）は規則から出す（postId は null、status は waiting）。止めた・飛ばした回は出さない
export async function listUpcomingAutoRuns(projectId: string, from: Date, until: Date): Promise<UpcomingAutoRun[]> {
  const client = await db();
  const [plans, runs] = await Promise.all([
    client.from("auto_plans").select(PLAN_COLUMNS).eq("project_id", projectId).eq("status", "active"),
    client
      .from("auto_runs")
      .select(RUN_COLUMNS)
      .eq("project_id", projectId)
      .gt("due_at", from.toISOString())
      .lte("due_at", until.toISOString()),
  ]);
  if (plans.error) throw new Error(`auto_plans: ${plans.error.message}`);
  if (runs.error) throw new Error(`auto_runs: ${runs.error.message}`);
  const known = new Map((runs.data as RunRow[]).map((r) => [`${r.plan_id}|${new Date(r.due_at).getTime()}`, toRun(r)]));
  const out: UpcomingAutoRun[] = [];
  for (const plan of (plans.data as PlanRow[]).map(toPlan)) {
    const sns = Object.keys(plan.targets) as SnsKey[];
    for (const at of dueTimes(plan.schedule, from, until)) {
      const run = known.get(`${plan.id}|${at.getTime()}`);
      if (run && ["canceled", "skipped"].includes(run.status)) continue;
      out.push({ runId: run?.id ?? "", planId: plan.id, planName: plan.name, dueAt: at.toISOString(), status: run?.status ?? "waiting", postId: run?.postId ?? null, sns });
    }
  }
  return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

type PreviewRow = { target_id: string; sns: string; status: string; title: string | null; body: string; fingerprint: string; approved_at: string | null };

export async function loadTargetPreviews(client: Db, postId: string): Promise<AutoTargetPreview[]> {
  const { data, error } = await client.rpc("auto_target_previews", { p_post_id: postId });
  if (error) throw new Error(`auto_target_previews: ${error.message}`);
  return ((data ?? []) as PreviewRow[])
    .filter((r) => isSnsKey(r.sns))
    .map((r) => ({ targetId: r.target_id, sns: r.sns as SnsKey, status: r.status, title: r.title, body: r.body, fingerprint: r.fingerprint, approvedAt: r.approved_at }));
}

// その回の投稿に添えた画像・動画（確かめる画面で、送る中身をそのまま見せる）。行は利用者の権限で読み（RLS で本人のものだけ）、
// 見る URL はそのあとにサーバーの権限で作る（1 時間で切れる。いまの作成画面と同じ）。承認の指紋（post_target_approval_fingerprint）と同じく、消した動画は数えない
export async function loadReviewMedia(client: Db, postId: string): Promise<ReviewMedia> {
  const { data, error } = await client
    .from("media_files")
    .select("id, kind, storage_path, alt_text, width, height, duration_ms, position")
    .eq("post_id", postId)
    .is("removed_at", null)
    .order("position")
    .order("id");
  if (error) throw new Error(`media_files: ${error.message}`);
  const rows = data ?? [];
  const imageRows = rows.filter((r) => r.kind === "image");
  const videoRow = rows.find((r) => r.kind === "video") ?? null;
  if (!imageRows.length && !videoRow) return NO_MEDIA;
  const admin = createAdminClient();
  const urls = await signedUrls(admin, imageRows.map((r) => r.storage_path), PREVIEW_URL_SECONDS);
  return {
    images: imageRows.map((r) => ({ id: r.id, url: urls.get(r.storage_path) ?? null, altText: r.alt_text, width: r.width, height: r.height })),
    video: videoRow
      ? { id: videoRow.id, url: await signedVideoUrl(admin, videoRow.storage_path, PREVIEW_URL_SECONDS), width: videoRow.width, height: videoRow.height, durationMs: videoRow.duration_ms ?? 0 }
      : null,
  };
}

// 確かめ待ち（送る時刻の前のもの）。最初の回の確かめ（A3）と、確かめて送る SNS の承認待ち。
// media: false なら画像・動画を読まない（数を数えるだけのとき。URL を作らない）
export async function listAutoReviewItems(projectId: string, { media = true }: { media?: boolean } = {}): Promise<AutoReviewItem[]> {
  const client = await db();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("auto_runs")
    .select(`${RUN_COLUMNS}, auto_plans(name)`)
    .eq("project_id", projectId)
    .in("status", ["review", "scheduled"])
    .gt("due_at", now)
    .not("post_id", "is", null)
    .order("due_at");
  if (error) throw new Error(`auto_runs: ${error.message}`);
  const items: AutoReviewItem[] = [];
  for (const r of data as (RunRow & { auto_plans: { name: string } | null })[]) {
    const targets = await loadTargetPreviews(client, r.post_id!);
    const waiting = targets.some((t) => t.status === "awaiting_approval");
    if (r.status === "scheduled" && !waiting) continue;
    items.push({
      kind: r.status === "review" ? "first_review" : "approval",
      runId: r.id,
      planId: r.plan_id,
      planName: r.auto_plans?.name ?? "",
      postId: r.post_id!,
      dueAt: r.due_at,
      targets,
      media: media ? await loadReviewMedia(client, r.post_id!) : NO_MEDIA,
    });
  }
  return items;
}

// 確かめ待ちの数（一覧の上と概要の帯）
export async function countAutoReviewItems(projectId: string): Promise<number> {
  return (await listAutoReviewItems(projectId, { media: false })).length;
}

// お知らせ・季節の予定（日付の順）
export async function listProjectEvents(projectId: string): Promise<ProjectEvent[]> {
  const { data, error } = await (await db()).from("project_events").select("id, on_date, body").eq("project_id", projectId).order("on_date").order("created_at");
  if (error) throw new Error(`project_events: ${error.message}`);
  return data.map((r) => ({ id: r.id, onDate: r.on_date, body: r.body }));
}
