import type { CreatorInfo } from "./api";

// TikTok に送るときの決まり（docs/design/tiktok.md の 3.〜8.）。画面とサーバーの両方から読む、計算だけの部分

export const PRIVACY_LEVELS = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];
export const PRIVACY_LABEL: Record<PrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: "全員",
  MUTUAL_FOLLOW_FRIENDS: "相互フォローの友だち",
  FOLLOWER_OF_CREATOR: "フォロワー",
  SELF_ONLY: "自分だけ",
};
export const TIKTOK_TITLE_MAX = 90;
export const TIKTOK_DESCRIPTION_MAX = 4000;
export const TIKTOK_MAX_PHOTOS = 35;

// 同意したときの設定（post_target_tiktok の 1 行）
export type TikTokSettings = {
  privacy_level: PrivacyLevel;
  disable_comment: boolean;
  brand_organic: boolean;
  brand_content: boolean;
  post_mode: "DIRECT_POST" | "MEDIA_UPLOAD";
  is_aigc: boolean;
  consent_text_hash: string;
  consent_nickname: string;
  consent_username: string;
};

// UTF-16 で数える（TikTok の字数の数え方。絵文字は 2）
export const utf16Length = (s: string) => s.length;

// 審査の前（TIKTOK_AUDITED が false）は「自分だけ」しか選べない
export function allowedPrivacy(creator: Pick<CreatorInfo, "privacyLevelOptions">, audited: boolean): PrivacyLevel[] {
  const opts = creator.privacyLevelOptions.filter((p): p is PrivacyLevel => (PRIVACY_LEVELS as readonly string[]).includes(p));
  return audited ? opts : opts.filter((p) => p === "SELF_ONLY");
}

// 宣伝の内容のラベルの説明（Content Sharing Guidelines の文のまま）と、同意の文
export function commercialLabel(s: { brandOrganic: boolean; brandContent: boolean }): string | null {
  if (s.brandContent) return "Your photo will be labeled as 'Paid partnership'";
  if (s.brandOrganic) return "Your photo will be labeled as 'Promotional content'";
  return null;
}
export function consentDeclaration(brandContent: boolean): { text: string; links: { label: string; href: string }[] } {
  const music = { label: "Music Usage Confirmation", href: "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" };
  if (brandContent) {
    return { text: "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.", links: [{ label: "Branded Content Policy", href: "https://www.tiktok.com/legal/page/global/bc-policy/en" }, music] };
  }
  return { text: "By posting, you agree to TikTok's Music Usage Confirmation.", links: [music] };
}

// 送ってよい設定か（画面とサーバーの保存の両方で確かめる）。だめなら理由
export function settingsProblem(
  s: { privacyLevel: string | null; brandOrganic: boolean; brandContent: boolean; commercial: boolean },
  allowed: PrivacyLevel[],
): string | null {
  if (!s.privacyLevel) return "TikTok の公開範囲を選んでください";
  if (!allowed.includes(s.privacyLevel as PrivacyLevel)) return "選んだ TikTok の公開範囲は、いまのアカウントでは選べません";
  if (s.commercial && !s.brandOrganic && !s.brandContent) return "宣伝の内容は「自分のブランド」か「ブランドコンテンツ」を選んでください";
  if (s.brandContent && s.privacyLevel === "SELF_ONLY") return "ブランドコンテンツは「自分だけ」にできません";
  return null;
}

// 写真の投稿の本文（直接投稿か下書き）。is_aigc の置き場所は写真の資料のとおり一番上（動画の資料では post_info の中。サンドボックスで確かめる）
export function photoInitBody(args: { settings: TikTokSettings; title: string; description: string; urls: string[] }): Record<string, unknown> {
  const { settings: s } = args;
  const direct = s.post_mode === "DIRECT_POST";
  const postInfo: Record<string, unknown> = { title: args.title, description: args.description };
  if (direct) {
    Object.assign(postInfo, {
      privacy_level: s.privacy_level,
      disable_comment: s.disable_comment,
      auto_add_music: false,
      brand_content_toggle: s.brand_content,
      brand_organic_toggle: s.brand_organic,
    });
  }
  return {
    post_info: postInfo,
    source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: args.urls },
    post_mode: s.post_mode,
    media_type: "PHOTO",
    ...(s.is_aigc ? { is_aigc: true } : {}),
  };
}

// 送ったあとの失敗の理由の扱い（status/fetch の fail_reason・投稿の窓口の error.code）
export type FailKind = "retryable" | "auth" | "permanent";
export function failureOf(reason: string): { kind: FailKind; message: string } {
  switch (reason) {
    case "internal":
    case "photo_pull_failed":
    case "video_pull_failed":
    case "rate_limit_exceeded":
      return { kind: "retryable", message: "TikTok 側で一時的に送れませんでした。少しあとで送り直します。" };
    case "auth_removed":
    case "access_token_invalid":
    case "scope_not_authorized":
      return { kind: "auth", message: "TikTok とのつながりが切れています。プロジェクトの設定の「つないだ SNS」からつなぎ直してください。" };
    case "spam_risk_too_many_posts":
      return { kind: "permanent", message: "今日の TikTok の投稿の上限（1 日 15 本ほど、ほかのアプリの分も含む）に達しました。明日送るか、TikTok のアプリから投稿してください。" };
    case "spam_risk_too_many_pending_share":
      return { kind: "permanent", message: "TikTok の受信箱に、仕上げていない下書きが多すぎます（24 時間で 5 件まで）。TikTok のアプリで、下書きを仕上げるか消してください。" };
    case "reached_active_user_cap":
      return { kind: "permanent", message: "いまは yabumi が TikTok の審査を受けている途中のため、TikTok に送れる人数の上限に達しています（yabumi の準備の都合です）。明日送るか、TikTok のアプリから投稿してください。" };
    case "unaudited_client_can_only_post_to_private_accounts":
      return { kind: "permanent", message: "いまは yabumi が TikTok の審査を受けている途中のため、非公開の TikTok のアカウントにしか送れません。TikTok のアカウントを非公開にしてから送り直してください。" };
    case "app_version_check_failed":
      return { kind: "permanent", message: "TikTok のアプリが古いため、下書きを送れませんでした。TikTok のアプリを新しくしてから送り直してください。" };
    case "privacy_level_option_mismatch":
      return { kind: "permanent", message: "選んだ TikTok の公開範囲は、いまのアカウントでは選べません。投稿の画面で選び直してください。" };
    case "url_ownership_unverified":
      return { kind: "permanent", message: "TikTok に写真を渡せませんでした（yabumi の設定の問題です）。運営者に知らせました。" };
    case "picture_size_check_failed":
    case "file_format_check_failed":
      return { kind: "permanent", message: "TikTok が写真の形を受け付けませんでした。写真を選び直してから送り直してください。" };
    case "spam_risk_user_banned_from_posting":
    case "spam_risk_text":
    case "spam_risk":
      return { kind: "permanent", message: "TikTok がこの投稿を受け付けませんでした。TikTok のアプリで、アカウントの状態を確認してください。" };
    default:
      return { kind: "permanent", message: `TikTok に送れませんでした（${reason || "理由はわかりません"}）。投稿の画面で確認してから、もう一度送ってください。` };
  }
}
