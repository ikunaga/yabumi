import type { SnsKey } from "@/lib/sns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePlan } from "@/lib/plan/schema";
import { InvalidImageError, sanitizeJpeg } from "@/lib/media/jpeg";
import { MEDIA_BUCKET, PREVIEW_URL_SECONDS } from "@/lib/media/rules";
import { TEMPLATE_SIZES, type TemplateSizeKey } from "@/lib/media/templates";
import { alertIfNearBudgetSafely } from "@/lib/notify/budget";
import type { Database } from "@/lib/supabase/database.types";
import type { ModelOutput } from "./app-description";
import { ImageBlockedError, type GenerateImage } from "./gemini-image";
import { AiUnavailableError, aiFailureMessage } from "./provider-failure";
import { checkAiLimits, jstPeriodStarts, type AiLimits } from "./limits";
import {
  MAX_PHOTOS_PER_RUN,
  MAX_SCENE_CHARS,
  PHOTO_ASPECT,
  PHOTO_LIMITS,
  PHOTO_STYLES,
  buildPhotoIdeasRequest,
  buildPhotoPrompt,
  normalizePhotoIdeas,
  type PhotoIdea,
  type PhotoStyle,
} from "./photo";
import { estimateCostUsd, estimateImageCostUsd } from "./pricing";
import { productTypeOf } from "./product-guide";

// AI で写真・絵をつくる処理（docs/architecture.md の 4.25 の ②、決定 D35）。
// user は利用者の権限のクライアント（プロジェクトを読む）、admin は RLS を通らないクライアント（予約・記録・置き場所）。
// userId は呼ぶ側で、ログイン中の利用者（getClaims の sub）であることを確かめて渡す

type Db = SupabaseClient<Database>;

// 候補を置く場所。添えた画像（<利用者の ID>/<乱数>.jpg）とは分け、記録（media_files）を作らないので、1 日で片付けの対象になる
export function candidatePath(ownerId: string, id: string, ext: "jpg" | "png" | "webp"): string {
  return `${ownerId}/gen/${id}.${ext}`;
}

// ── 今月の残りと、注意を読んだか ──

export type PhotoStatus = { acknowledged: boolean; usedImages: number; remainingImages: number; globalReached: boolean };

export async function photoStatus(admin: Db, userId: string, model: string, now = new Date()): Promise<PhotoStatus> {
  const { monthStart } = jstPeriodStarts(now);
  const [{ data: notice }, { data: mine, error }, { data: all, error: allError }] = await Promise.all([
    admin.from("ai_image_notices").select("owner_id").eq("owner_id", userId).maybeSingle(),
    admin.from("ai_image_jobs").select("images").eq("owner_id", userId).neq("status", "failed").gte("created_at", monthStart.toISOString()),
    // 全体の費用は、上限に達したかどうかだけを見る（ほかの人の数は画面に出さない）。
    // 上限（$6.66）までは 1 回 1〜2 枚で 200 行ほどなので、API の 1,000 行の上限に届かない
    admin.from("ai_image_jobs").select("cost_usd").neq("status", "failed").gte("created_at", monthStart.toISOString()),
  ]);
  if (error) throw error;
  if (allError) throw allError;
  const usedImages = (mine ?? []).reduce((n, r) => n + r.images, 0);
  const globalUsd = (all ?? []).reduce((n, r) => n + Number(r.cost_usd), 0);
  return {
    acknowledged: Boolean(notice),
    usedImages,
    remainingImages: Math.max(0, PHOTO_LIMITS.userMonthlyImages - usedImages),
    globalReached: globalUsd + estimateImageCostUsd(model, 1) > PHOTO_LIMITS.globalMonthlyUsd,
  };
}

export async function acknowledgePhotoNotice(admin: Db, userId: string): Promise<void> {
  const { error } = await admin.from("ai_image_notices").upsert({ owner_id: userId }, { onConflict: "owner_id", ignoreDuplicates: true });
  if (error) throw error;
}

// ── ① 絵の説明の案（Claude。AI の上限 4.9 に数える） ──

export type CallPhotoIdeas = (req: ReturnType<typeof buildPhotoIdeasRequest>) => Promise<ModelOutput>;
export type IdeasOutcome = { ok: true; ideas: PhotoIdea[] } | { ok: false; message: string };

export async function runPhotoIdeas(
  user: Db,
  admin: Db,
  deps: { callIdeas: CallPhotoIdeas; limits: AiLimits; now?: () => Date },
  // sns: 送り先の SNS（投稿の柱は、この SNS に付いたものだけを材料にする）
  args: { userId: string; projectId: string; text: string; sns?: SnsKey[] },
): Promise<IdeasOutcome> {
  const text = args.text.trim();
  if (!text) return { ok: false, message: "投稿の本文を書いてから押してください。絵の説明は本文から考えます。" };
  if ([...text].length > 5000) return { ok: false, message: "本文が長すぎます（5,000 字まで）。" };
  const { data: project } = await user.from("projects").select("*").eq("id", args.projectId).maybeSingle();
  if (!project) return { ok: false, message: "プロジェクトが見つかりません。" };
  const { data: planRow } = await user.from("account_plans").select("data").eq("project_id", args.projectId).maybeSingle();

  const limit = await checkAiLimits(admin, args.userId, deps.limits, deps.now?.() ?? new Date());
  if (!limit.ok) return { ok: false, message: limit.message };

  let r: ModelOutput;
  try {
    r = await deps.callIdeas(
      buildPhotoIdeasRequest(
        { projectName: project.name, plan: normalizePlan(planRow?.data, project.target_audience ?? ""), productType: productTypeOf(project.product_type), sns: args.sns },
        text,
      ),
    );
  } catch (e) {
    console.error("[photo-ideas] AI の呼び出しに失敗しました", e instanceof Error ? e.message : e);
    return { ok: false, message: aiFailureMessage(e, "AI とのやりとりがうまくいきませんでした。時間をおいてもう一度お試しください。") + "説明は手で書くこともできます。" };
  }
  await admin.from("ai_usage").insert({
    owner_id: args.userId,
    thread_id: null,
    purpose: "image_photo_idea",
    model: r.model,
    input_tokens: r.usage.inputTokens,
    cache_write_tokens: r.usage.cacheWriteTokens,
    cache_read_tokens: r.usage.cacheReadTokens,
    output_tokens: r.usage.outputTokens,
    cost_usd: estimateCostUsd(r.model, r.usage),
  });
  if (r.stopReason === "refusal") return { ok: false, message: "AI がこの投稿には答えられませんでした。説明は手で書けます。" };
  const ideas = r.stopReason === "end_turn" ? normalizePhotoIdeas(r.output) : null;
  if (!ideas) return { ok: false, message: "うまく案を出せませんでした。もう一度お試しください。" };
  return { ok: true, ideas };
}

// ── ② 画像をつくる（Gemini。画像だけの上限 D35） ──

export type PhotoCandidate = { path: string; url: string; width: number; height: number };
export type GenerateOutcome =
  | { ok: true; jobId: string; candidates: PhotoCandidate[]; remainingImages: number; partial: boolean }
  | { ok: false; message: string; remainingImages?: number };

const LIMIT_MESSAGE = {
  user_limit: `今月の AI の画像は上限（1 人 ${PHOTO_LIMITS.userMonthlyImages} 枚）に達しました。来月 1 日にまたつくれます。テンプレートの画像と、手持ちの写真は使えます。`,
  global_limit: "今月の AI の画像が、yabumi 全体の上限に達しました。来月 1 日にまたつくれます。テンプレートの画像と、手持ちの写真は使えます。",
} as const;

export async function runPhotoGeneration(
  user: Db,
  admin: Db,
  deps: { generate: GenerateImage; model: string; scopeOwner?: string },
  args: { userId: string; projectId: string; scene: string; style: PhotoStyle; size: TemplateSizeKey; count: number },
): Promise<GenerateOutcome> {
  const scene = args.scene.trim();
  if (!scene) return { ok: false, message: "絵の説明を書いてください。" };
  if ([...scene].length > MAX_SCENE_CHARS) return { ok: false, message: `絵の説明は ${MAX_SCENE_CHARS} 字までです。` };
  if (!PHOTO_STYLES.includes(args.style) || !(args.size in TEMPLATE_SIZES)) return { ok: false, message: "入力の形式が正しくありません。" };
  const count = Math.trunc(args.count);
  if (count < 1 || count > MAX_PHOTOS_PER_RUN) return { ok: false, message: `1 回に ${MAX_PHOTOS_PER_RUN} 枚までです。` };

  const { data: project } = await user.from("projects").select("id").eq("id", args.projectId).maybeSingle();
  if (!project) return { ok: false, message: "プロジェクトが見つかりません。" };
  const { data: notice } = await admin.from("ai_image_notices").select("owner_id").eq("owner_id", args.userId).maybeSingle();
  if (!notice) return { ok: false, message: "先に、AI の画像の注意を読んで「わかりました」を押してください。" };

  // 押す前に、見込みの費用で予約する（同時に押されても上限を超えない）
  const reserveUsd = estimateImageCostUsd(deps.model, count);
  const { data: reserved, error: reserveError } = await admin.rpc("reserve_ai_images", {
    p_owner_id: args.userId,
    p_project_id: args.projectId,
    p_model: deps.model,
    p_images: count,
    p_cost_usd: reserveUsd,
    ...(deps.scopeOwner ? { p_scope_owner: deps.scopeOwner } : {}),
  });
  if (reserveError) throw reserveError;
  const r = reserved?.[0];
  if (!r) throw new Error("予約の結果がありません");
  // 全体の上限の 80% に達したら運営者に知らせる（月に 1 回。失敗しても止めない）
  await alertIfNearBudgetSafely(admin, "image", Number(r.global_month_usd ?? 0), PHOTO_LIMITS.globalMonthlyUsd, { scope: deps.scopeOwner });
  const remainingAfter = (used: number) => Math.max(0, PHOTO_LIMITS.userMonthlyImages - used);
  if (r.status !== "ok" || !r.job_id) {
    const key = r.status === "global_limit" ? "global_limit" : "user_limit";
    return { ok: false, message: LIMIT_MESSAGE[key], remainingImages: remainingAfter(r.user_month_images ?? 0) };
  }
  const jobId = r.job_id;
  const usedBefore = (r.user_month_images ?? count) - count;

  const prompt = buildPhotoPrompt(scene, args.style);
  const results = await Promise.allSettled(Array.from({ length: count }, () => deps.generate({ prompt, aspectRatio: PHOTO_ASPECT[args.size] })));

  const stored: PhotoCandidate[] = [];
  let inputTokens = 0;
  let blocked = false;
  let unavailable = false;
  for (const res of results) {
    if (res.status === "rejected") {
      if (res.reason instanceof ImageBlockedError) blocked = true;
      else if (res.reason instanceof AiUnavailableError) unavailable = true;
      else console.error("[photo-gen] 画像の AI の呼び出しに失敗しました", res.reason instanceof Error ? res.reason.message : res.reason);
      continue;
    }
    inputTokens += res.value.inputTokens;
    try {
      const { bytes, ext, contentType, width, height } = checkImage(res.value.bytes, res.value.mimeType);
      const path = candidatePath(args.userId, crypto.randomUUID(), ext);
      const { error } = await admin.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
      if (error) throw error;
      stored.push({ path, url: "", width, height });
    } catch (e) {
      console.error("[photo-gen] 画像を置けませんでした", e instanceof Error ? e.message : e);
    }
  }

  // 実際にできた枚数と費用に直す（作られなかった分は数えない）。Google の料金は、できた画像の枚数で決まる
  const made = results.filter((x) => x.status === "fulfilled").length;
  const { error: settleError } = await admin
    .from("ai_image_jobs")
    .update(
      made
        ? { status: "done", images: made, cost_usd: estimateImageCostUsd(deps.model, made, inputTokens) }
        : { status: "failed", images: 0, cost_usd: 0 },
    )
    .eq("id", jobId);
  if (settleError) console.error("[photo-gen] 予約を直せませんでした", settleError.message);
  const remainingImages = remainingAfter(usedBefore + made);

  if (!stored.length) {
    return {
      ok: false,
      remainingImages,
      message: unavailable
        ? "AI の画像はいま使えません（運営者に知らせました。枚数には数えません）。テンプレートの画像と、手持ちの写真は使えます。"
        : blocked
          ? "この説明では、画像の AI の安全の決まりに当たって作れませんでした。説明を変えてお試しください（枚数には数えません）。"
          : "画像をつくれませんでした。時間をおいてもう一度お試しください（枚数には数えません）。",
    };
  }
  const { data: urls, error: urlError } = await admin.storage.from(MEDIA_BUCKET).createSignedUrls(stored.map((s) => s.path), PREVIEW_URL_SECONDS);
  if (urlError) throw urlError;
  const byPath = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));
  return {
    ok: true,
    jobId,
    candidates: stored.map((s) => ({ ...s, url: byPath.get(s.path) ?? "" })).filter((s) => s.url),
    remainingImages,
    partial: stored.length < count,
  };
}

// 返ってきた画像の中身を確かめる。JPEG はメタデータを消し、大きさを読む（PNG・WebP は大きさを画面で読む）
function checkImage(bytes: Uint8Array, mimeType: string): { bytes: Uint8Array; ext: "jpg" | "png" | "webp"; contentType: string; width: number; height: number } {
  if (bytes.length > 8 * 1024 * 1024) throw new Error("画像が大きすぎます");
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const clean = sanitizeJpeg(bytes);
    return { bytes: clean.bytes, ext: "jpg", contentType: "image/jpeg", width: clean.width, height: clean.height };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { bytes, ext: "png", contentType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType === "image/webp" && bytes.length > 12) return { bytes, ext: "webp", contentType: "image/webp", width: 0, height: 0 };
  throw new InvalidImageError("画像として読めません");
}

// 添える画像が、この利用者が 1 日以内に AI で作ったものから来たか（AI の印を付けるため）。
// 候補の表示の URL を作り直す（署名つきの URL は 1 時間で切れる。候補のファイルは 1 日で片付けられる）。
// その利用者の 1 日以内の記録（jobId）で、その利用者の候補の置き場所（<利用者の ID>/gen/<乱数>.<拡張子>）だけを受ける。ほかは null
export async function refreshCandidateUrls(admin: Db, userId: string, jobId: string, paths: string[], now = new Date()): Promise<{ path: string; url: string }[] | null> {
  const own = new RegExp(`^${userId}/gen/[0-9a-f-]{36}\\.(jpg|png|webp)$`);
  if (!paths.length || paths.length > MAX_PHOTOS_PER_RUN || !paths.every((p) => own.test(p))) return null;
  if (!(await ownRecentPhotoJob(admin, userId, jobId, now))) return null;
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUrls(paths, PREVIEW_URL_SECONDS);
  if (error) return null;
  const urls = (data ?? []).flatMap((u) => (!u.error && u.signedUrl && u.path ? [{ path: u.path, url: u.signedUrl }] : []));
  return urls.length === paths.length ? urls : null;
}
// 印を付けるかどうかだけに使う（作っていない画像に印を付けても、利用者の損にはならない）
export async function ownRecentPhotoJob(admin: Db, userId: string, jobId: string, now = new Date()): Promise<boolean> {
  const { data } = await admin
    .from("ai_image_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("owner_id", userId)
    .eq("status", "done")
    .gte("created_at", new Date(now.getTime() - 24 * 3600_000).toISOString())
    .maybeSingle();
  return Boolean(data);
}
