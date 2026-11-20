import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { adapters } from "@/lib/sns/adapters";
import { loadAccount } from "@/lib/sns/publisher";
import { CANNOT_POST_CODES, TikTokApiError, fetchCreatorInfo, type CreatorInfo } from "./api";
import { tiktokAudited } from "./config";
import { allowedPrivacy, failureOf, settingsProblem } from "./publish";
import { consentHash } from "./send-check";
import type { TikTokChoice } from "./choice";

// TikTok に送るときの同意（docs/design/tiktok.md の 3. と 4.）。予約・今すぐ送るの保存で、サーバーが creator_info を読み直して確かめ、
// 同意の記録（post_target_tiktok）を書く。同意の時刻・文の指紋・AI の印・ニックネームはサーバーが決める（画面からは受け取らない）
type Admin = SupabaseClient<Database>;

export type CheckedTikTok = { choice: TikTokChoice; creator: CreatorInfo };

// つないだ TikTok のアカウントのトークン（送る直前と同じく、切れそうなら取り直す）と、いまの creator_info
async function creatorOf(admin: Admin, accountId: string): Promise<{ creator: CreatorInfo; scopes: string[] } | { error: string }> {
  const { data: acc } = await admin.from("social_accounts").select("external_id").eq("id", accountId).maybeSingle();
  const adapter = adapters.tiktok;
  if (!acc || !adapter) return { error: "TikTok がつながっていません。" };
  const account = await loadAccount(admin, accountId, acc.external_id, {}, adapter);
  if (!account) return { error: "TikTok とのつながりが切れています。プロジェクトの設定の「つないだ SNS」からつなぎ直してください。" };
  const { data: tok } = await admin.from("social_account_tokens").select("scopes").eq("social_account_id", accountId).maybeSingle();
  try {
    return { creator: await fetchCreatorInfo(account.accessToken), scopes: tok?.scopes ?? [] };
  } catch (e) {
    if (e instanceof TikTokApiError && (CANNOT_POST_CODES as readonly string[]).includes(e.code)) return { error: failureOf(e.code).message };
    if (e instanceof TikTokApiError && (e.code === "access_token_invalid" || e.code === "scope_not_authorized")) return { error: failureOf(e.code).message };
    console.error("[tiktok] creator_info を読めませんでした", e instanceof Error ? e.message : e);
    return { error: "TikTok のアカウントの状態を読めませんでした。時間をおいてもう一度お試しください。" };
  }
}

// 画面に出す、つないだ TikTok のいまの状態（ニックネーム・選べる公開範囲・コメントの可否）。読めなければ理由
export async function tiktokCreatorFor(admin: Admin, accountId: string) {
  const r = await creatorOf(admin, accountId);
  if ("error" in r) return { error: r.error };
  const audited = tiktokAudited();
  return {
    nickname: r.creator.nickname,
    username: r.creator.username,
    avatarUrl: r.creator.avatarUrl,
    privacyOptions: allowedPrivacy(r.creator, audited),
    commentDisabled: r.creator.commentDisabled,
    canDirect: r.scopes.includes("video.publish"),
    canInbox: r.scopes.includes("video.upload"),
    audited,
  };
}

// 保存の前の確かめ。だめなら理由
export async function checkTikTokChoice(admin: Admin, accountId: string, choice: TikTokChoice | undefined): Promise<CheckedTikTok | { error: string }> {
  if (!choice) return { error: "TikTok の公開範囲などを選んで、同意してから送ってください" };
  const r = await creatorOf(admin, accountId);
  if ("error" in r) return r;
  if (choice.mode === "DIRECT_POST") {
    if (!r.scopes.includes("video.publish")) return { error: "TikTok に直接投稿する許可がありません。「TikTok のアプリで仕上げる」で送るか、つなぎ直してください" };
    const problem = settingsProblem(choice, allowedPrivacy(r.creator, tiktokAudited()));
    if (problem) return { error: problem };
    if (!choice.allowComment) {
      // コメントを許可しないのはいつでもよい
    } else if (r.creator.commentDisabled) {
      return { error: "この TikTok のアカウントでは、コメントを許可できません（TikTok の設定でコメントが「誰もできない」になっています）" };
    }
  } else if (!r.scopes.includes("video.upload")) {
    return { error: "TikTok に下書きを送る許可がありません。つなぎ直してください" };
  }
  return { choice, creator: r.creator };
}

// 同意の記録を書く（保存のあと。送信ジョブはこの記録と creator_info を送る直前に照らす）
export async function writeTikTokConsent(
  admin: Admin,
  args: { userId: string; postId: string; title: string; text: string; mediaIds: string[]; checked: CheckedTikTok; now?: Date },
): Promise<void> {
  const { data: target, error } = await admin.from("post_targets").select("id").eq("post_id", args.postId).eq("owner_id", args.userId).eq("sns", "tiktok").single();
  if (error) throw error;
  const { data: media } = args.mediaIds.length ? await admin.from("media_files").select("ai_generated").eq("owner_id", args.userId).in("id", args.mediaIds) : { data: [] };
  const c = args.checked.choice;
  const direct = c.mode === "DIRECT_POST";
  const { error: e2 } = await admin.from("post_target_tiktok").upsert({
    post_target_id: target.id,
    owner_id: args.userId,
    // 下書き（MEDIA_UPLOAD）は、公開範囲を TikTok のアプリで決めるので、ここでは「自分だけ」を入れておく（送るときは使わない）
    privacy_level: direct ? c.privacyLevel! : "SELF_ONLY",
    disable_comment: !(direct && c.allowComment),
    brand_organic: direct && c.commercial && c.brandOrganic,
    brand_content: direct && c.commercial && c.brandContent,
    post_mode: c.mode,
    is_aigc: (media ?? []).some((m) => m.ai_generated),
    consented_at: (args.now ?? new Date()).toISOString(),
    consent_text_hash: consentHash(args.title, args.text),
    consent_nickname: args.checked.creator.nickname,
    consent_username: args.checked.creator.username,
    updated_at: (args.now ?? new Date()).toISOString(),
  });
  if (e2) throw e2;
}

// 送った TikTok が下書き（受信箱。MEDIA_UPLOAD）だったか。投稿の画面の結果の札を分けるため（2026-11-21 PM の指示）。
// post_target_tiktok はサーバーだけが読める表なので、本人の投稿の配信先であることを確かめてから読む（youtubeChoiceOf と同じ）
export async function tiktokSentAsDraft(admin: SupabaseClient<Database>, postId: string, userId: string): Promise<boolean> {
  const { data: t } = await admin.from("post_targets").select("id").eq("post_id", postId).eq("owner_id", userId).eq("sns", "tiktok").maybeSingle();
  if (!t) return false;
  const { data: s } = await admin.from("post_target_tiktok").select("post_mode").eq("post_target_id", t.id).eq("owner_id", userId).maybeSingle();
  return s?.post_mode === "MEDIA_UPLOAD";
}
