import { createHash } from "node:crypto";
import type { CreatorInfo } from "./api";
import { allowedPrivacy, type TikTokSettings } from "./publish";

// TikTok の同意の指紋と、送る直前の確かめ（docs/design/tiktok.md の 4.）。サーバーだけで使う（node:crypto）

// 同意したときのタイトルと説明の指紋。送る直前の文と比べ、同意のあとに変えていたら送らない
export function consentHash(title: string, description: string): string {
  return createHash("sha256").update(`${title}\u0000${description}`, "utf8").digest("hex");
}

// 送る直前の確かめ。同意したときと変わっていたら、送らずに理由を返す
export function checkBeforeSend(args: { settings: TikTokSettings | null; creator: CreatorInfo; title: string; description: string; audited: boolean }): string | null {
  const { settings, creator } = args;
  if (!settings) return "TikTok の公開範囲などを選んで同意してから送ってください。投稿の画面で確認してください。";
  if (settings.post_mode === "DIRECT_POST" && !allowedPrivacy(creator, args.audited).includes(settings.privacy_level)) {
    return "TikTok の公開範囲が、予約のときに選んだものを選べなくなっていたので、送りませんでした。投稿の画面で確認してから、もう一度送ってください。";
  }
  if (settings.consent_nickname !== creator.nickname || (settings.consent_username && creator.username && settings.consent_username !== creator.username)) {
    return "つないでいる TikTok のアカウントが、予約のときと違っていたので、送りませんでした。投稿の画面で確認してから、もう一度送ってください。";
  }
  if (consentHash(args.title, args.description) !== settings.consent_text_hash) {
    return "TikTok のタイトルか説明が、同意したあとに変わっていたので、送りませんでした。投稿の画面で確認してから、もう一度送ってください。";
  }
  return null;
}

