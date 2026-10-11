import { xWeightedLength } from "./x-text";

// 対象の SNS（要求 D1、D15）と、投稿のルール
export type SnsKey = "x" | "instagram" | "facebook" | "threads" | "tiktok" | "youtube" | "note" | "substack";

export type MediaRequirement = "none" | "image_or_video" | "video";

// auto: 矢書がつないで自動で送る / manual: 公式の投稿 API がないので、利用者が手で投稿する（D15）
export type Delivery = "auto" | "manual";

type SnsSpec = {
  label: string;
  // 画面に出す文字数の上限（X は全角換算）。null は実質上限なし
  maxLength: number | null;
  media: MediaRequirement;
  delivery: Delivery;
  // 長文の SNS は、タイトルを付けて投稿する
  needsTitle?: boolean;
  // 1 つの投稿に付けられる画像の数（各社の公式の資料、2026-10-11。docs/architecture.md の 4.18）。
  // 0 は、矢書からは画像を送らない（動画だけの SNS、手で投稿する SNS）
  maxImages: number;
};

export const SNS: Record<SnsKey, SnsSpec> = {
  // X は写真 4 枚まで。Threads はカルーセルで 20 枚まで。Instagram はカルーセルで 10 枚まで
  x: { label: "X", maxLength: 140, media: "none", delivery: "auto", maxImages: 4 },
  threads: { label: "Threads", maxLength: 500, media: "none", delivery: "auto", maxImages: 20 },
  instagram: { label: "Instagram", maxLength: 2200, media: "image_or_video", delivery: "auto", maxImages: 10 },
  // Facebook ページの複数の写真の上限は公式の資料で確かめられなかった。つなぐときに確かめる
  facebook: { label: "Facebook", maxLength: null, media: "none", delivery: "auto", maxImages: 10 },
  tiktok: { label: "TikTok", maxLength: 2200, media: "video", delivery: "auto", maxImages: 0 },
  youtube: { label: "YouTube", maxLength: 5000, media: "video", delivery: "auto", maxImages: 0 },
  // note・Substack は本文の上限が公表されていないので、上限なしとして扱う。画像は利用者が投稿の画面で手で添える
  note: { label: "note", maxLength: null, media: "none", delivery: "manual", needsTitle: true, maxImages: 0 },
  substack: { label: "Substack", maxLength: null, media: "none", delivery: "manual", needsTitle: true, maxImages: 0 },
};

// 画面に並べる順（デザインの「送り先と文面の調整」の順。手で投稿する SNS は最後）
export const SNS_KEYS: SnsKey[] = ["x", "threads", "instagram", "facebook", "tiktok", "youtube", "note", "substack"];

export const MANUAL_SNS_KEYS: SnsKey[] = SNS_KEYS.filter((k) => SNS[k].delivery === "manual");

export function isManualSns(sns: SnsKey): boolean {
  return SNS[sns].delivery === "manual";
}

export const MAX_TITLE_LENGTH = 200;

// 手で投稿する SNS の、投稿の画面の URL。Substack は人ごとにアドレスが違うので、登録したプロフィールの URL から作る
export function manualComposeUrl(sns: SnsKey, profileUrl?: string | null): string | null {
  if (sns === "note") return "https://note.com/notes/new";
  if (sns === "substack") {
    if (profileUrl) {
      try {
        const u = new URL(profileUrl);
        if (u.protocol === "https:" && (u.hostname.endsWith(".substack.com") || !u.hostname.endsWith("substack.com"))) return `${u.origin}/publish/post`;
      } catch {
        // URL として読めない
      }
    }
    return "https://substack.com/home";
  }
  return null;
}

// X の投稿の画面（本文を入れた状態で開く）。自動で送れなかったときに手で投稿するために使う
export function xComposeUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function isSnsKey(value: unknown): value is SnsKey {
  return typeof value === "string" && (SNS_KEYS as string[]).includes(value);
}

// X の文字数の数え方は x-text.ts。利用者には全角換算（重みの半分、切り上げ）で見せる
export { hasXUrl, xWeightedLength } from "./x-text";

// 画面に出す文字数
export function displayLength(sns: SnsKey, text: string): number {
  if (sns === "x") return Math.ceil(xWeightedLength(text) / 2);
  return [...text].length;
}

export type TargetIssue =
  | "empty"
  | "too_long"
  | "needs_image"
  | "needs_video"
  | "needs_title"
  | "too_many_images"
  | "bad_aspect_ratio"
  | "too_many_hashtags";

export type TargetCheck = {
  length: number;
  maxLength: number | null;
  issues: TargetIssue[];
};

// 1 つの SNS 向けの文面が送れる状態かを調べる。動画の添付はまだないので、動画が必要な SNS は常に指摘する
// Instagram の画像の縦横比（幅 ÷ 高さ）。4:5（縦長）〜 1.91:1（横長）。外れると Instagram が断る（docs/architecture.md の 4.21）
export const INSTAGRAM_MIN_RATIO = 4 / 5;
export const INSTAGRAM_MAX_RATIO = 1.91;
// Instagram のハッシュタグの上限
export const INSTAGRAM_MAX_HASHTAGS = 30;

export function instagramRatioOk(width: number, height: number): boolean {
  if (!width || !height) return false;
  const r = width / height;
  // 縮めたときの端数で外れないよう、少しだけゆとりを持たせる
  return r >= INSTAGRAM_MIN_RATIO - 0.005 && r <= INSTAGRAM_MAX_RATIO + 0.005;
}

export function countHashtags(text: string): number {
  return (text.match(/(^|[^\p{L}\p{N}_&])[#＃][\p{L}\p{N}_]+/gu) ?? []).length;
}

export function checkTarget(
  sns: SnsKey,
  text: string,
  // sizes: 画像の幅と高さ（Instagram の縦横比を確かめるときだけ使う）
  media: { images: number; videos: number; sizes?: { width: number; height: number }[] } = { images: 0, videos: 0 },
  title: string | null = null,
): TargetCheck {
  const spec = SNS[sns];
  const length = displayLength(sns, text);
  const issues: TargetIssue[] = [];
  if (text.trim() === "") issues.push("empty");
  if (spec.maxLength !== null && length > spec.maxLength) issues.push("too_long");
  if (spec.media === "image_or_video" && media.images + media.videos === 0) issues.push("needs_image");
  if (spec.media === "video" && media.videos === 0) issues.push("needs_video");
  if (spec.needsTitle && !(title ?? "").trim()) issues.push("needs_title");
  if (spec.maxImages > 0 && media.images > spec.maxImages) issues.push("too_many_images");
  if (sns === "instagram") {
    if (media.sizes?.some((s) => !instagramRatioOk(s.width, s.height))) issues.push("bad_aspect_ratio");
    if (countHashtags(text) > INSTAGRAM_MAX_HASHTAGS) issues.push("too_many_hashtags");
  }
  return { length, maxLength: spec.maxLength, issues };
}

export const ISSUE_LABEL: Record<TargetIssue, string> = {
  empty: "本文がありません",
  too_long: "文字数オーバー",
  needs_image: "画像が必要",
  needs_video: "動画が必要",
  needs_title: "タイトルが必要",
  too_many_images: "画像が多すぎます",
  bad_aspect_ratio: "画像の縦横比が合いません",
  too_many_hashtags: "ハッシュタグが多すぎます",
};

// 画像を付けても、この SNS には送らない（動画だけの SNS、手で投稿する SNS）。作成画面で知らせる
export function ignoresImages(sns: SnsKey): boolean {
  return SNS[sns].maxImages === 0;
}
