import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckContext } from "@/lib/ai/ai-check";
import { withAiBudget } from "@/lib/ai/budget";
import type { GenerateImage } from "@/lib/ai/gemini-image";
import { buildFormatSceneRequest, buildPhotoIdeasRequest, normalizePhotoIdeas } from "@/lib/ai/photo";
import { candidatePath, runAutoPhoto, type AutoPhoto, type CallPhotoIdeas } from "@/lib/ai/photo-gen";
import { productTypeOf } from "@/lib/ai/product-guide";
import { sanitizeJpeg, withAiMark, type AiSource } from "@/lib/media/jpeg";
import { initialHeadline, headlineInput, type HeadlineSettings } from "@/lib/media/headline";
import { cleanHeadline } from "@/lib/media/headline-text";
import { SERVER_FONTS } from "@/lib/media/server-fonts";
import { renderTemplateJpeg } from "@/lib/media/template-render-server";
import { MAX_ALT_LENGTH, MAX_IMAGES_PER_POST, MEDIA_BUCKET, USER_QUOTA_BYTES, mediaPath } from "@/lib/media/rules";
import { defaultSizeFor, type TemplateSizeKey } from "@/lib/media/templates";
import { normalizePlan } from "@/lib/plan/schema";
import { answerSlotName, fillImageText, hasUnfilled, MAX_IMAGE_LABEL } from "@/lib/post-formats/image";
import { getFormat } from "@/lib/post-formats/store";
import type { SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import type { Material } from "./materials";
import type { AutoImageLook, AutoPlan } from "./types";

// 自動の回の画像（docs/design/auto-sample-image.md の 2.。2026-11-19 オーナーが Q3・Q5・Q6 をおすすめで了承）。
// 絵の説明はサーバーが作る（画面から受け取らない）: フォーマットの画像の設定にその回の穴の言葉・答えを入れたもの（「AI が場面に書き換える」なら Claude が場面を書く）か、
// その回の本文から Claude が書いた場面。画像は自動の投稿の分の枠（reserve_ai_images の p_auto）で 1 枚つくる。
// 場面の Claude は用途 auto_post_scene（自動の投稿の AI の枠）

type Db = SupabaseClient<Database>;

export type AutoImageDeps = { generate: GenerateImage; model: string; callScene: CallPhotoIdeas; scopeOwner?: string; asOf?: Date };

// base・headline: 見出しを重ねたとき、重ねる前の写真（候補の置き場所）と見出しの設定。添えるとき、写真を「元の画像」として残し（4.68）、
// 投稿の画面の「見出しを直す」で直せるようにする
export type MadeImage = AutoPhoto & { alt: string; base?: { path: string; width: number; height: number }; headline?: HeadlineSettings };
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

// フォーマットの見出しと、その上の小さい文（空欄を埋め、描ける形にそろえる。小さい文は見出しがあるときだけ・20 字まで）
export function formatHeadlineTexts(
  image: { headline: string | null; label: string | null },
  values: Record<string, string>,
  answer: { name: string; value: string } | null,
): { headline: string; label: string } {
  const headline = image.headline ? cleanHeadline(fillImageText(image.headline, values, answer)) : "";
  const label = headline && image.label ? [...cleanHeadline(fillImageText(image.label, values, answer))].slice(0, MAX_IMAGE_LABEL).join("").trim() : "";
  return { headline, label };
}

// その回の画像を 1 枚つくる（候補の置き場所 <持ち主>/gen/ に置く。添えるのは attachImage）
export async function makeAutoImage(
  admin: Db,
  deps: AutoImageDeps | undefined,
  // headline: AI が文と一緒に書いた見出し（回し方で「見出しを AI が書く」のとき）
  args: { plan: AutoPlan & { ownerId: string }; texts: Partial<Record<SnsKey, string>>; sns: SnsKey[]; material: Material; headline?: string },
): Promise<ImageOutcome> {
  const img = args.plan.image;
  if (!img) return { ok: false, detail: "画像の設定がありません" };
  if (!deps) return { ok: false, detail: "AI の画像は準備中です" };
  const ctx = await context(admin, args.plan, args.sns);
  if (!ctx) return { ok: false, detail: "プロジェクトが見つかりません" };

  let scene: string | null;
  let style = img.style;
  let size = img.size;
  let headlineText = img.headline === "ai" ? cleanHeadline(args.headline) : "";
  // 見出しの上の小さい文（フォーマットの見出しのときだけ。2026-11-20 オーナーの指示。見出しを 2 段にする）
  let labelText = "";
  if (img.source === "format") {
    const formatId = args.material.series?.formatId ?? args.plan.materials.format_id;
    const format = formatId ? await getFormat(admin, args.plan.projectId, formatId) : null;
    if (!format?.image) return { ok: false, detail: "フォーマットに画像の設定がありません" };
    const name = answerSlotName(format.series);
    const answer = args.material.series?.answer?.trim();
    const filled = fillImageText(format.image.prompt, args.material.series?.values ?? {}, name && answer ? { name, value: answer } : null);
    if (hasUnfilled(filled)) return { ok: false, detail: "フォーマットの絵の説明に、埋まらない空欄があります" };
    scene = format.image.scene === "ai" ? await writeScene(admin, deps, args.plan.ownerId, buildFormatSceneRequest(ctx, filled)) : filled;
    style = format.image.style;
    size = format.image.size;
    if (img.headline === "format") ({ headline: headlineText, label: labelText } = formatHeadlineTexts(format.image, args.material.series?.values ?? {}, name && answer ? { name, value: answer } : null));
  } else {
    const text = args.sns.map((s) => args.texts[s]).find((t) => t?.trim());
    if (!text) return { ok: false, detail: "画像の場面を書く本文がありません" };
    scene = await writeScene(admin, deps, args.plan.ownerId, buildPhotoIdeasRequest(ctx, text, null));
  }
  if (!scene) return { ok: false, detail: "画像の場面を書けませんでした" };
  const sizeKey: TemplateSizeKey = size === "auto" ? defaultSizeFor(args.sns).size : size;
  const r = await runAutoPhoto(admin, deps, { userId: args.plan.ownerId, projectId: args.plan.projectId, scene, style, size: sizeKey });
  if (!r.ok) return { ok: false, detail: r.message };
  const plain: MadeImage = { ...r.photo, alt: [...scene].slice(0, MAX_ALT_LENGTH).join("") };
  if (!headlineText) return { ok: true, image: plain };
  // 見出しを重ねる（サーバーで描く。④）。描けなかったときは、見出しなしの写真を添える（回は止めない）
  try {
    return { ok: true, image: await overlayHeadline(admin, args.plan.ownerId, r.photo, { headline: headlineText, label: labelText }, img.look, plain.alt) };
  } catch (e) {
    console.error("[auto-post] 見出しを重ねられませんでした", e instanceof Error ? e.message : e);
    return { ok: true, image: plain };
  }
}

// 見出しを重ねる。並べ方・色・書体・置き方は画面の「文字を入れる」と同じ（headlineInput。写真を全面に敷く screen）。
// 描いた画像も候補の置き場所に置く（添えるときに印を入れて上げ直す）。画像の説明の先頭に、描いたのと同じ見出しの文を入れる
async function overlayHeadline(admin: Db, ownerId: string, photo: AutoPhoto, texts: { headline: string; label: string }, look: AutoImageLook | undefined, scene: string): Promise<MadeImage> {
  const text = texts.headline;
  const { data: blob, error } = await admin.storage.from(MEDIA_BUCKET).download(photo.path);
  if (error || !blob) throw error ?? new Error("download");
  const settings: HeadlineSettings = { ...initialHeadline(photo, "", look ?? null), label: texts.label, headline: text };
  const { bytes } = await renderTemplateJpeg(headlineInput(settings, SERVER_FONTS[settings.font], photo), new Uint8Array(await blob.arrayBuffer()));
  const clean = sanitizeJpeg(bytes);
  const path = candidatePath(ownerId, crypto.randomUUID(), "jpg");
  const { error: upError } = await admin.storage.from(MEDIA_BUCKET).upload(path, clean.bytes, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
  if (upError) throw upError;
  return {
    path,
    width: clean.width,
    height: clean.height,
    jobId: photo.jobId,
    // 画像の説明にも、描いたのと同じ文（上の小さい文があれば「小さい文／見出し」）
    alt: [...`見出し「${texts.label ? `${texts.label}／` : ""}${text}」。${scene}`].slice(0, MAX_ALT_LENGTH).join(""),
    base: { path: photo.path, width: photo.width, height: photo.height },
    headline: settings,
  };
}

// 候補の置き場所から読み、AI で作ったことの印（XMP）を入れて、添えた画像の置き場所に上げる
async function uploadMarked(admin: Db, ownerId: string, from: string, source: AiSource): Promise<{ path: string; size: number } | null> {
  if (!from.startsWith(`${ownerId}/gen/`) || !from.endsWith(".jpg")) return null;
  try {
    const { data: blob, error } = await admin.storage.from(MEDIA_BUCKET).download(from);
    if (error || !blob) throw error ?? new Error("download");
    const bytes = withAiMark(sanitizeJpeg(new Uint8Array(await blob.arrayBuffer())).bytes, source);
    const path = mediaPath(ownerId, crypto.randomUUID());
    const { error: upError } = await admin.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
    if (upError) throw upError;
    return { path, size: bytes.length };
  } catch (e) {
    console.error("[auto-post] 画像を上げられませんでした", e instanceof Error ? e.message : e);
    return null;
  }
}

// 候補の画像をその回の投稿に添える（手でつくった AI の画像と同じく、画像の中に AI で作ったことの印を入れ、AI の印を付けた記録を作る。
// /privacy「AI で作った画像には、画像の中に AI で作ったことの印を入れます」）。見出しを重ねた画像は、重ねる前の写真を「元の画像」として残す
// （source_of でその画像を指し、投稿には添えない。4.68 の形。印は写真が generated、見出しを重ねたものが composite）
export async function attachImage(admin: Db, ownerId: string, postId: string, image: MadeImage): Promise<boolean> {
  const { count } = await admin.from("media_files").select("id", { count: "exact", head: true }).eq("post_id", postId).eq("kind", "image");
  const { data: used } = await admin.rpc("media_usage_bytes", { p_owner_id: ownerId });
  if ((count ?? 0) >= MAX_IMAGES_PER_POST) return false;
  const uploaded: string[] = [];
  const undo = async () => {
    if (uploaded.length) await admin.storage.from(MEDIA_BUCKET).remove(uploaded);
  };
  let source: { id: string } | null = null;
  // 1 人の容量（USER_QUOTA_BYTES）には、添えた画像と元の画像の両方を数える
  let adding = 0;
  if (image.base && image.headline) {
    const b = await uploadMarked(admin, ownerId, image.base.path, "generated");
    if (!b) return false;
    uploaded.push(b.path);
    adding += b.size;
    if (Number(used ?? 0) + adding > USER_QUOTA_BYTES) {
      await undo();
      return false;
    }
    const { data, error } = await admin
      .from("media_files")
      .insert({ owner_id: ownerId, storage_path: b.path, width: image.base.width, height: image.base.height, size_bytes: b.size, ai_generated: true })
      .select("id")
      .single();
    if (error) {
      console.error("[auto-post] 元の画像の記録を作れませんでした", error.message);
      await undo();
      return false;
    }
    source = data;
  }
  const f = await uploadMarked(admin, ownerId, image.path, source ? "composite" : "generated");
  if (!f) {
    if (source) await admin.from("media_files").delete().eq("id", source.id);
    await undo();
    return false;
  }
  uploaded.push(f.path);
  adding += f.size;
  if (Number(used ?? 0) + adding > USER_QUOTA_BYTES) {
    if (source) await admin.from("media_files").delete().eq("id", source.id);
    await undo();
    return false;
  }
  const { data: row, error } = await admin
    .from("media_files")
    .insert({
      owner_id: ownerId,
      post_id: postId,
      storage_path: f.path,
      position: count ?? 0,
      alt_text: image.alt,
      width: image.width,
      height: image.height,
      size_bytes: f.size,
      ai_generated: true,
      ...(source && image.headline ? { original_id: source.id, edit_base_id: source.id, edit: { kind: "headline", headline: image.headline } as never, has_text: true } : {}),
    })
    .select("id")
    .single();
  if (error) {
    if (source) await admin.from("media_files").delete().eq("id", source.id);
    await undo();
    console.error("[auto-post] 画像の記録を作れませんでした", error.message);
    return false;
  }
  if (source) {
    const { error: linkError } = await admin.from("media_files").update({ source_of: row.id }).eq("id", source.id).eq("owner_id", ownerId);
    if (linkError) console.error("[auto-post] 元の画像を結びつけられませんでした", linkError.message);
  }
  return true;
}
