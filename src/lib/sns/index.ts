// 対象の SNS（要求 D1）と、投稿のルール
export type SnsKey = "x" | "instagram" | "facebook" | "threads" | "tiktok" | "youtube";

export type MediaRequirement = "none" | "image_or_video" | "video";

type SnsSpec = {
  label: string;
  // 画面に出す文字数の上限（X は全角換算）。null は実質上限なし
  maxLength: number | null;
  media: MediaRequirement;
};

export const SNS: Record<SnsKey, SnsSpec> = {
  x: { label: "X", maxLength: 140, media: "none" },
  threads: { label: "Threads", maxLength: 500, media: "none" },
  instagram: { label: "Instagram", maxLength: 2200, media: "image_or_video" },
  facebook: { label: "Facebook", maxLength: null, media: "none" },
  tiktok: { label: "TikTok", maxLength: 2200, media: "video" },
  youtube: { label: "YouTube", maxLength: 5000, media: "video" },
};

// 画面に並べる順（デザインの「送り先と文面の調整」の順）
export const SNS_KEYS: SnsKey[] = ["x", "threads", "instagram", "facebook", "tiktok", "youtube"];

export function isSnsKey(value: unknown): value is SnsKey {
  return typeof value === "string" && (SNS_KEYS as string[]).includes(value);
}

const URL_RE = /https?:\/\/[^\s]+/g;
const X_URL_WEIGHT = 23;

// X の文字数。半角英数などは 1、日本語などは 2、URL は長さに関係なく 23 として数え、上限は 280。
// 利用者には全角換算（重みの半分、切り上げ）で見せる
export function xWeightedLength(text: string): number {
  let weight = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    weight += X_URL_WEIGHT;
    return "";
  });
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0)!;
    const light =
      (cp >= 0 && cp <= 4351) || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
    weight += light ? 1 : 2;
  }
  return weight;
}

// 画面に出す文字数
export function displayLength(sns: SnsKey, text: string): number {
  if (sns === "x") return Math.ceil(xWeightedLength(text) / 2);
  return [...text].length;
}

export type TargetIssue = "empty" | "too_long" | "needs_image" | "needs_video";

export type TargetCheck = {
  length: number;
  maxLength: number | null;
  issues: TargetIssue[];
};

// 1 つの SNS 向けの文面が送れる状態かを調べる。画像・動画の添付はまだないので、必要な SNS は常に指摘する
export function checkTarget(sns: SnsKey, text: string, media: { images: number; videos: number } = { images: 0, videos: 0 }): TargetCheck {
  const spec = SNS[sns];
  const length = displayLength(sns, text);
  const issues: TargetIssue[] = [];
  if (text.trim() === "") issues.push("empty");
  if (spec.maxLength !== null && length > spec.maxLength) issues.push("too_long");
  if (spec.media === "image_or_video" && media.images + media.videos === 0) issues.push("needs_image");
  if (spec.media === "video" && media.videos === 0) issues.push("needs_video");
  return { length, maxLength: spec.maxLength, issues };
}

export const ISSUE_LABEL: Record<TargetIssue, string> = {
  empty: "本文がありません",
  too_long: "文字数オーバー",
  needs_image: "画像が必要",
  needs_video: "動画が必要",
};
