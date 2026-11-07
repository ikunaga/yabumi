"use server";

import { z } from "zod";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { TEMPLATE_SIZES, type TemplateSizeKey } from "@/lib/media/templates";
import { aiConfigured, callPhotoIdeas } from "./anthropic";
import { generateWithGemini, photoConfigured } from "./gemini-image";
import { MAX_PHOTOS_PER_RUN, MAX_SCENE_CHARS, PHOTO_STYLES, photoModel, photoUnitYen, type PhotoIdea } from "./photo";
import { acknowledgePhotoNotice, jstMonthDay, photoStatus, refreshCandidateUrls, runPhotoGeneration, runPhotoIdeas, type PhotoCandidate } from "./photo-gen";

const snsListSchema = z.array(z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]])).max(SNS_KEYS.length);

// 画面から呼ぶ、AI で写真・絵をつくる操作（docs/architecture.md の 4.25 の ②、決定 D35）。
// 利用者の ID は、ここでログインの情報（getClaims）から取る。画面から渡された値は使わない

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, userId: data?.claims?.sub ?? null };
}

export type PhotoPanelState = {
  // 画像の AI の鍵があるか（なければ「準備中」）
  enabled: boolean;
  // 場面の案を出す Claude があるか
  ideasEnabled: boolean;
  acknowledged: boolean;
  remainingImages: number;
  monthlyImages: number;
  // 登録して 7 日までの少なめが終わる日（日本時間の M/D。新しい人だけ）
  newUntil: string | null;
  globalReached: boolean;
  newUsersFull: boolean;
  unitYen: number;
};

export async function photoPanelState(): Promise<{ state?: PhotoPanelState; error?: string }> {
  const { userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  const model = photoModel();
  const base = { enabled: photoConfigured(), ideasEnabled: aiConfigured(), unitYen: photoUnitYen(model) };
  try {
    const s = await photoStatus(createAdminClient(), userId, model);
    return {
      state: {
        ...base,
        acknowledged: s.acknowledged,
        remainingImages: s.remainingImages,
        monthlyImages: s.monthlyImages,
        newUntil: s.newUntil ? jstMonthDay(s.newUntil) : null,
        globalReached: s.globalReached,
        newUsersFull: s.newUsersFull,
      },
    };
  } catch (e) {
    console.error("[photoPanelState]", e instanceof Error ? e.message : e);
    return { error: "AI の画像の状態を読めませんでした。時間をおいてもう一度お試しください。" };
  }
}

export async function acknowledgePhoto(): Promise<{ error?: string }> {
  if (!photoConfigured()) return { error: "AI の画像はまだ準備中です。" };
  const { userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    await acknowledgePhotoNotice(createAdminClient(), userId);
    return {};
  } catch (e) {
    console.error("[acknowledgePhoto]", e instanceof Error ? e.message : e);
    return { error: "うまくいきませんでした。もう一度お試しください。" };
  }
}

// sns: 送り先の SNS（投稿の柱は、この SNS に付いたものだけを材料にする）
// templateId: 選んだ絵の説明のフォーマット（null はフォーマットなし。画面は「いつも使う」をはじめから選んでおく）
export async function draftPhotoIdeas(projectId: string, text: unknown, sns: unknown = [], templateId: unknown = null): Promise<{ ideas?: PhotoIdea[]; error?: string }> {
  const t = z.string().max(10000).safeParse(text);
  const s = snsListSchema.safeParse(sns);
  const tid = z.uuid().nullable().safeParse(templateId);
  if (!z.uuid().safeParse(projectId).success || !t.success || !s.success || !tid.success) return { error: "入力の形式が正しくありません。" };
  if (!aiConfigured() || !photoConfigured()) return { error: "AI の画像はまだ準備中です。" };
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await runPhotoIdeas(supabase, createAdminClient(), { callIdeas: callPhotoIdeas }, { userId, projectId, text: t.data, sns: s.data, templateId: tid.data });
    return r.ok ? { ideas: r.ideas } : { error: r.message };
  } catch (e) {
    console.error("[draftPhotoIdeas]", e instanceof Error ? e.message : e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}

const generateInput = z.object({
  projectId: z.uuid(),
  scene: z.string().max(MAX_SCENE_CHARS * 2),
  style: z.enum(PHOTO_STYLES),
  size: z.enum(Object.keys(TEMPLATE_SIZES) as [TemplateSizeKey, ...TemplateSizeKey[]]),
  count: z.number().int().min(1).max(MAX_PHOTOS_PER_RUN),
});

export type GeneratePhotosResult = { jobId?: string; candidates?: PhotoCandidate[]; remainingImages?: number; partial?: boolean; error?: string };

export async function generatePhotos(input: unknown): Promise<GeneratePhotosResult> {
  const parsed = generateInput.safeParse(input);
  if (!parsed.success) return { error: "入力の形式が正しくありません。" };
  if (!photoConfigured()) return { error: "AI の画像はまだ準備中です。" };
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await runPhotoGeneration(supabase, createAdminClient(), { generate: generateWithGemini, model: photoModel() }, { userId, ...parsed.data });
    return r.ok ? { jobId: r.jobId, candidates: r.candidates, remainingImages: r.remainingImages, partial: r.partial } : { error: r.message, remainingImages: r.remainingImages };
  } catch (e) {
    console.error("[generatePhotos]", e instanceof Error ? e.message : e);
    return { error: "画像をつくれませんでした。時間をおいてもう一度お試しください。" };
  }
}

const refreshInput = z.object({ jobId: z.uuid(), paths: z.array(z.string().max(200)).min(1).max(MAX_PHOTOS_PER_RUN) });

// 候補の表示の URL を作り直す（候補に戻ったときに、1 時間の期限が切れていれば）。自分の 1 日以内の候補だけ
export async function refreshPhotoCandidates(input: unknown): Promise<{ urls?: { path: string; url: string }[]; error?: string }> {
  const parsed = refreshInput.safeParse(input);
  if (!parsed.success) return { error: "入力の形式が正しくありません。" };
  const { userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const urls = await refreshCandidateUrls(createAdminClient(), userId, parsed.data.jobId, parsed.data.paths);
    return urls ? { urls } : { error: "候補は 1 日で消えます。もう一度つくってください。" };
  } catch (e) {
    console.error("[refreshPhotoCandidates]", e instanceof Error ? e.message : e);
    return { error: "候補を読み直せませんでした。もう一度お試しください。" };
  }
}
