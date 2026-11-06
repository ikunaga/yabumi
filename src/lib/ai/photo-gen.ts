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
import { AiUnavailableError, aiFailureMessage, isRejectedStatus, notBilled } from "./provider-failure";
import { withAiBudget } from "./budget";
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
import { estimateImageCostUsd } from "./pricing";
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

// monthlyImages: その人の月の枚数（登録して 7 日までは少なめ）。newUntil: 少なめが終わる時刻（新しい人だけ）。
// globalReached: 全体の上限に届いた。newUsersFull: 登録 7 日以内の人たちの枠に届いた（新しい人だけ。どちらも、もう 1 枚も作れない）
export type PhotoStatus = {
  acknowledged: boolean;
  usedImages: number;
  remainingImages: number;
  monthlyImages: number;
  newUntil: string | null;
  globalReached: boolean;
  newUsersFull: boolean;
};

// 上限と数え方の正は DB の関数 ai_image_quota（予約の reserve_ai_images と同じ）。asOf・scopeOwner はテスト用（アプリからは渡さない）
export async function photoStatus(admin: Db, userId: string, model: string, opts: { asOf?: Date; scopeOwner?: string } = {}): Promise<PhotoStatus> {
  const [{ data: notice }, { data: quota, error }] = await Promise.all([
    admin.from("ai_image_notices").select("owner_id").eq("owner_id", userId).maybeSingle(),
    admin.rpc("ai_image_quota", {
      p_owner_id: userId,
      ...(opts.asOf ? { p_as_of: opts.asOf.toISOString() } : {}),
      ...(opts.scopeOwner ? { p_scope_owner: opts.scopeOwner } : {}),
    }),
  ]);
  if (error) throw error;
  const q = quota?.[0];
  if (!q) throw new Error("上限を数えられませんでした");
  const one = estimateImageCostUsd(model, 1);
  // 予約（reserve_ai_images）と同じく、新しい人だけに 3 分の 1 の枠を当てる
  const newUsersFull = q.new_until !== null && Number(q.new_users_month_usd) + one > PHOTO_LIMITS.globalMonthlyUsd * PHOTO_LIMITS.newUsersGlobalShare;
  return {
    acknowledged: Boolean(notice),
    usedImages: q.user_month_images,
    remainingImages: Math.max(0, q.user_monthly_limit - q.user_month_images),
    monthlyImages: q.user_monthly_limit,
    newUntil: q.new_until,
    globalReached: Number(q.global_month_usd) + one > PHOTO_LIMITS.globalMonthlyUsd,
    newUsersFull,
  };
}

// 日本時間の「月/日」（登録して 7 日までの少なめが終わる日。文章の AI の文言とそろえる）
export function jstMonthDay(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// 上限に届いたときの文（status は reserve_ai_images の返す理由）
export function photoLimitMessage(status: string, r: { newUntil: string | null }): string {
  const rest = "テンプレートの画像と、手持ちの写真は使えます。";
  const back = r.newUntil ? jstMonthDay(r.newUntil) : null;
  switch (status) {
    case "attempt_limit":
      return `AI の画像は 1 日 ${PHOTO_LIMITS.dailyAttempts} 回まで試せます（作れなかった回も数えます）。明日またお試しください。${rest}`;
    case "global_limit":
      return `今月の AI の画像が、yabumi 全体の上限に達しました。来月 1 日にまたつくれます。${rest}`;
    case "new_users_limit":
      return `登録して ${PHOTO_LIMITS.newUserDays} 日までの方が使える今月の AI の画像の枠が、いっぱいになりました。${back} からつくれます（月 ${PHOTO_LIMITS.userMonthlyImages} 枚まで）。${rest}`;
    default:
      return back
        ? `登録して ${PHOTO_LIMITS.newUserDays} 日までは、AI の画像は月 ${PHOTO_LIMITS.newUserMonthlyImages} 枚までです。${back} から月 ${PHOTO_LIMITS.userMonthlyImages} 枚になります。${rest}`
        : `今月の AI の画像は上限（1 人 ${PHOTO_LIMITS.userMonthlyImages} 枚）に達しました。来月 1 日にまたつくれます。${rest}`;
  }
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
  deps: { callIdeas: CallPhotoIdeas; now?: () => Date },
  // sns: 送り先の SNS（投稿の柱は、この SNS に付いたものだけを材料にする）
  args: { userId: string; projectId: string; text: string; sns?: SnsKey[] },
): Promise<IdeasOutcome> {
  const text = args.text.trim();
  if (!text) return { ok: false, message: "投稿の本文を書いてから押してください。絵の説明は本文から考えます。" };
  if ([...text].length > 5000) return { ok: false, message: "本文が長すぎます（5,000 字まで）。" };
  const { data: project } = await user.from("projects").select("*").eq("id", args.projectId).maybeSingle();
  if (!project) return { ok: false, message: "プロジェクトが見つかりません。" };
  const { data: planRow } = await user.from("account_plans").select("data").eq("project_id", args.projectId).maybeSingle();

  let r: ModelOutput;
  try {
    // 呼ぶ前に上限の分を予約する（返事のあとで実際の額に直す。budget.ts）
    const b = await withAiBudget(
      admin,
      { userId: args.userId, purpose: "image_photo_idea", call: "photo_ideas", now: deps.now?.() },
      buildPhotoIdeasRequest(
        { projectName: project.name, plan: normalizePlan(planRow?.data, project.target_audience ?? ""), productType: productTypeOf(project.product_type), sns: args.sns },
        text,
      ),
      deps.callIdeas,
    );
    if (!b.ok) return { ok: false, message: b.message };
    r = b.result;
  } catch (e) {
    console.error("[photo-ideas] AI の呼び出しに失敗しました", e instanceof Error ? e.message : e);
    return { ok: false, message: aiFailureMessage(e, "AI とのやりとりがうまくいきませんでした。時間をおいてもう一度お試しください。") + "説明は手で書くこともできます。" };
  }
  if (r.stopReason === "refusal") return { ok: false, message: "AI がこの投稿には答えられませんでした。説明は手で書けます。" };
  const ideas = r.stopReason === "end_turn" ? normalizePhotoIdeas(r.output) : null;
  if (!ideas) return { ok: false, message: "うまく案を出せませんでした。もう一度お試しください。" };
  return { ok: true, ideas };
}

// ── ② 画像をつくる（Gemini。画像だけの上限 D35） ──

// 請求されないとはっきりしている失敗か: HTTP の 4xx（408 を除く）で処理の前に断られた（安全の決まりの 4xx を含む）・支払いや鍵の問題。
// 200 の返事の中で安全の決まりに断られたときは、請求されたかわからないので含めない（セキュリティ確認 2026-11-06 の DB-L2 の続き）
export function imageNotBilled(e: unknown): boolean {
  if (e instanceof ImageBlockedError) return e.httpStatus !== null && isRejectedStatus(e.httpStatus);
  return notBilled(e);
}

export type PhotoCandidate = { path: string; url: string; width: number; height: number };
export type GenerateOutcome =
  | { ok: true; jobId: string; candidates: PhotoCandidate[]; remainingImages: number; partial: boolean }
  | { ok: false; message: string; remainingImages?: number };

export async function runPhotoGeneration(
  user: Db,
  admin: Db,
  // scopeOwner・asOf はテスト用（アプリからは渡さない）
  deps: { generate: GenerateImage; model: string; scopeOwner?: string; asOf?: Date },
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
    ...(deps.asOf ? { p_as_of: deps.asOf.toISOString() } : {}),
  });
  if (reserveError) throw reserveError;
  const r = reserved?.[0];
  if (!r) throw new Error("予約の結果がありません");
  // 全体の上限の 80% に達したら運営者に知らせる（月に 1 回。失敗しても止めない）
  await alertIfNearBudgetSafely(admin, "image", Number(r.global_month_usd ?? 0), PHOTO_LIMITS.globalMonthlyUsd, { scope: deps.scopeOwner });
  const remainingAfter = (used: number) => Math.max(0, r.user_monthly_limit - used);
  if (r.status !== "ok" || !r.job_id) {
    return { ok: false, message: photoLimitMessage(r.status, { newUntil: r.new_until }), remainingImages: remainingAfter(r.user_month_images ?? 0) };
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

  // 実際にできた枚数と費用に直す。Google の料金は、できた画像の枚数で決まる。
  // 作られなかった分は、請求されないとはっきりしている失敗（408 を除く HTTP の 4xx・支払いや鍵の問題）だけ 0 にし、
  // それ以外（タイムアウト・5xx・形の合わない返事・200 の返事の中での安全の決まりの断り）は請求されたかわからないので、見込みの額のまま数える（セキュリティ確認 2026-11-06 の L2）。
  // 枚数（利用者の月の枚数）には、できた分だけを数える
  const made = results.filter((x) => x.status === "fulfilled").length;
  const unclear = results.filter((x) => x.status === "rejected" && !imageNotBilled(x.reason)).length;
  const unclearUsd = unclear ? estimateImageCostUsd(deps.model, unclear) : 0;
  const { error: settleError } = await admin
    .from("ai_image_jobs")
    .update(
      made
        ? { status: "done", images: made, cost_usd: estimateImageCostUsd(deps.model, made, inputTokens) + unclearUsd }
        : { status: "failed", images: 0, cost_usd: unclearUsd },
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
