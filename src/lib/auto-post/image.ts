import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckContext } from "@/lib/ai/ai-check";
import { withAiBudget } from "@/lib/ai/budget";
import type { GenerateImage } from "@/lib/ai/gemini-image";
import { buildFormatSceneRequest, buildPhotoIdeasRequest, normalizePhotoIdeas } from "@/lib/ai/photo";
import { runAutoPhoto, type AutoPhoto, type CallPhotoIdeas } from "@/lib/ai/photo-gen";
import { productTypeOf } from "@/lib/ai/product-guide";
import { sanitizeJpeg, withAiMark } from "@/lib/media/jpeg";
import { MAX_ALT_LENGTH, MAX_IMAGES_PER_POST, MEDIA_BUCKET, USER_QUOTA_BYTES, mediaPath } from "@/lib/media/rules";
import { defaultSizeFor, type TemplateSizeKey } from "@/lib/media/templates";
import { normalizePlan } from "@/lib/plan/schema";
import { answerSlotName, fillImageText, hasUnfilled } from "@/lib/post-formats/image";
import { getFormat } from "@/lib/post-formats/store";
import type { SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import type { Material } from "./materials";
import type { AutoPlan } from "./types";

// 自動の回の画像（docs/design/auto-sample-image.md の 2.。2026-11-19 オーナーが Q3・Q5・Q6 をおすすめで了承）。
// 絵の説明はサーバーが作る（画面から受け取らない）: フォーマットの画像の設定にその回の穴の言葉・答えを入れたもの（「AI が場面に直す」なら Claude が場面を書く）か、
// その回の本文から Claude が書いた場面。画像は自動の投稿の分の枠（reserve_ai_images の p_auto）で 1 枚つくる。
// 場面の Claude は用途 auto_post_scene（自動の投稿の AI の枠）

type Db = SupabaseClient<Database>;

export type AutoImageDeps = { generate: GenerateImage; model: string; callScene: CallPhotoIdeas; scopeOwner?: string; asOf?: Date };

export type MadeImage = AutoPhoto & { alt: string };
export type ImageOutcome = { ok: true; image: MadeImage } | { ok: false; detail: string };

async function context(admin: Db, plan: AutoPlan & { ownerId: string }, sns: SnsKey[]): Promise<CheckContext | null> {
  const { data: project } = await admin.from("projects").select("name, target_audience, product_type").eq("id", plan.projectId).eq("owner_id", plan.ownerId).maybeSingle();
  if (!project) return null;
  const { data: planRow } = await admin.from("account_plans").select("data").eq("project_id", plan.projectId).maybeSingle();
  return { projectName: project.name, plan: normalizePlan(planRow?.data, project.target_audience ?? ""), productType: productTypeOf(project.product_type), sns };
}

// Claude に場面を 1 つ書いてもらう（自動の投稿の AI の枠）
async function writeScene(admin: Db, deps: AutoImageDeps, ownerId: string, request: ReturnType<typeof buildPhotoIdeasRequest>): Promise<string | null> {
  const b = await withAiBudget(admin, { userId: ownerId, purpose: "auto_post_scene", call: "photo_ideas" }, request, deps.callScene);
  if (!b.ok) return null;
  const ideas = b.result.stopReason === "end_turn" ? normalizePhotoIdeas(b.result.output) : null;
  return ideas?.[0]?.scene ?? null;
}

// その回の画像を 1 枚つくる（候補の置き場所 <持ち主>/gen/ に置く。添えるのは attachImage）
export async function makeAutoImage(
  admin: Db,
  deps: AutoImageDeps | undefined,
  args: { plan: AutoPlan & { ownerId: string }; texts: Partial<Record<SnsKey, string>>; sns: SnsKey[]; material: Material },
): Promise<ImageOutcome> {
  const img = args.plan.image;
  if (!img) return { ok: false, detail: "画像の設定がありません" };
  if (!deps) return { ok: false, detail: "AI の画像は準備中です" };
  const ctx = await context(admin, args.plan, args.sns);
  if (!ctx) return { ok: false, detail: "プロジェクトが見つかりません" };

  let scene: string | null;
  let style = img.style;
  let size = img.size;
  if (img.source === "format") {
    const formatId = args.material.series?.formatId ?? args.plan.materials.format_id;
    const format = formatId ? await getFormat(admin, args.plan.projectId, formatId) : null;
    if (!format?.image) return { ok: false, detail: "フォーマットに画像の設定がありません" };
    const name = answerSlotName(format.series);
    const answer = args.material.series?.answer?.trim();
    const filled = fillImageText(format.image.prompt, args.material.series?.values ?? {}, name && answer ? { name, value: answer } : null);
    if (hasUnfilled(filled)) return { ok: false, detail: "フォーマットの絵の説明に、埋まらない穴があります" };
    scene = format.image.scene === "ai" ? await writeScene(admin, deps, args.plan.ownerId, buildFormatSceneRequest(ctx, filled)) : filled;
    style = format.image.style;
    size = format.image.size;
  } else {
    const text = args.sns.map((s) => args.texts[s]).find((t) => t?.trim());
    if (!text) return { ok: false, detail: "画像の場面を書く本文がありません" };
    scene = await writeScene(admin, deps, args.plan.ownerId, buildPhotoIdeasRequest(ctx, text, null));
  }
  if (!scene) return { ok: false, detail: "画像の場面を書けませんでした" };
  const sizeKey: TemplateSizeKey = size === "auto" ? defaultSizeFor(args.sns).size : size;
  const r = await runAutoPhoto(admin, deps, { userId: args.plan.ownerId, projectId: args.plan.projectId, scene, style, size: sizeKey });
  if (!r.ok) return { ok: false, detail: r.message };
  return { ok: true, image: { ...r.photo, alt: [...scene].slice(0, MAX_ALT_LENGTH).join("") } };
}

// 候補の画像をその回の投稿に添える（添えた画像の置き場所に、AI で作ったことの印〈XMP〉を入れて上げ直し、AI の印を付けた記録を作る。
// 手でつくった AI の画像を添えるときと同じ印。/privacy「AI で作った画像には、画像の中に AI で作ったことの印を入れます」）。JPEG だけ（Gemini には JPEG で頼んでいる）
export async function attachImage(admin: Db, ownerId: string, postId: string, image: MadeImage): Promise<boolean> {
  if (!image.path.startsWith(`${ownerId}/gen/`) || !image.path.endsWith(".jpg")) return false;
  let bytes: Uint8Array;
  try {
    const { data: blob, error: dlError } = await admin.storage.from(MEDIA_BUCKET).download(image.path);
    if (dlError || !blob) throw dlError ?? new Error("download");
    bytes = withAiMark(sanitizeJpeg(new Uint8Array(await blob.arrayBuffer())).bytes, "generated");
  } catch (e) {
    console.error("[auto-post] 画像を読めませんでした", e instanceof Error ? e.message : e);
    return false;
  }
  const { count } = await admin.from("media_files").select("id", { count: "exact", head: true }).eq("post_id", postId).eq("kind", "image");
  const { data: used } = await admin.rpc("media_usage_bytes", { p_owner_id: ownerId });
  if ((count ?? 0) >= MAX_IMAGES_PER_POST || Number(used ?? 0) + bytes.length > USER_QUOTA_BYTES) return false;
  const path = mediaPath(ownerId, crypto.randomUUID());
  const { error: upError } = await admin.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
  if (upError) {
    console.error("[auto-post] 画像を上げられませんでした", upError.message);
    return false;
  }
  const { error } = await admin.from("media_files").insert({
    owner_id: ownerId,
    post_id: postId,
    storage_path: path,
    position: count ?? 0,
    alt_text: image.alt,
    width: image.width,
    height: image.height,
    size_bytes: bytes.length,
    ai_generated: true,
  });
  if (error) {
    await admin.storage.from(MEDIA_BUCKET).remove([path]);
    console.error("[auto-post] 画像の記録を作れませんでした", error.message);
    return false;
  }
  return true;
}
