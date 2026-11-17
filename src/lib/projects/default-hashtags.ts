import type { SupabaseClient } from "@supabase/supabase-js";
import { formatTagsFor, readFormatHashtags, type FormatHashtags } from "@/lib/post-formats/schema";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { hashtagLine, splitTagsByText } from "@/lib/sns/hashtags";
import type { Database } from "@/lib/supabase/database.types";

// プロジェクトの「いつものタグ」（projects.default_hashtags。2026-11-17 オーナーの依頼、案 A。docs/architecture.md の 4.59）。
// 形は投稿のフォーマットのタグと同じ（all は全 SNS 共通、SNS の名前のキーはその SNS だけ。あればこちらを使う）。
// アカウント設計の hashtags（AI に渡す「付けるとき」つきの候補）とは別のもの
export type DefaultHashtags = FormatHashtags;

export const readDefaultHashtags = readFormatHashtags;

// その SNS に入れるいつものタグ（SNS だけのタグがあればそれ、なければ共通）
export const defaultTagsFor = (h: DefaultHashtags | null | undefined, sns: SnsKey): string[] => formatTagsFor(h, sns);

// 新しい投稿のタグの欄の初期値（SNS ごとの「#a #b」。タグのない SNS は持たない）
export function defaultTagInputs(h: DefaultHashtags | null | undefined): Partial<Record<SnsKey, string>> {
  const out: Partial<Record<SnsKey, string>> = {};
  for (const s of SNS_KEYS) {
    const tags = defaultTagsFor(h, s);
    if (tags.length) out[s] = hashtagLine(tags);
  }
  return out;
}

// 投稿をつくるで、フォーマットを入れたときの SNS ごとのタグ: フォーマットにその SNS のタグがあればそれ、なければいつものタグ（どちらもなければ空）
export function tagsAfterFormat(format: FormatHashtags | null | undefined, defaults: DefaultHashtags | null | undefined, sns: SnsKey): string[] {
  const own = formatTagsFor(format, sns);
  return own.length ? own : defaultTagsFor(defaults, sns);
}

type DraftTarget = { sns: SnsKey; body_override: string | null };

// サーバーで下書きを作るとき（AI のネタ・ネタ帳・相談）の配信先に、いつものタグを足す（save_post の p_targets の hashtags）。
// 本文（SNS ごとの文面があればそれ）にもう書いてあるタグは足さない（2 回出さない。savePost と同じ splitTagsByText）
export function withDefaultTags<T extends DraftTarget>(targets: T[], body: string, defaults: DefaultHashtags | null | undefined): (T & { hashtags: string[] })[] {
  return targets.map((t) => ({ ...t, hashtags: splitTagsByText(t.body_override ?? body, defaultTagsFor(defaults, t.sns)).keep }));
}

// 本人のプロジェクトのいつものタグ（RLS で本人の行だけ。読めなければ空）
export async function loadDefaultHashtags(db: SupabaseClient<Database>, projectId: string): Promise<DefaultHashtags> {
  const { data } = await db.from("projects").select("default_hashtags").eq("id", projectId).maybeSingle();
  return readDefaultHashtags(data?.default_hashtags ?? null);
}
