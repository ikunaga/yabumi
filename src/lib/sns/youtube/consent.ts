import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { adapters } from "@/lib/sns/adapters";
import { loadAccount } from "@/lib/sns/publisher";
import { consentHash } from "@/lib/sns/tiktok/send-check";
import { fetchMyChannel, YouTubeApiError, type YouTubeChannel } from "./api";
import { youtubeChoiceProblem, type YouTubeChoice } from "./choice";

// YouTube に送るときの同意（docs/design/youtube.md の 4.・5.）。予約・今すぐ送るの保存で、サーバーがチャンネルを読み直して確かめ、
// 同意の記録（post_target_youtube）を書く。同意の時刻・文の指紋・チャンネル名はサーバーが決める（画面からは受け取らない）
type Admin = SupabaseClient<Database>;

export type CheckedYouTube = { choice: YouTubeChoice; channel: YouTubeChannel };

const RECONNECT = "プロジェクトの設定の「つないだ SNS」からつなぎ直してください。";

// つないだチャンネル（送る直前と同じく、切れそうなら取り直す）
export async function youtubeChannelFor(admin: Admin, accountId: string): Promise<YouTubeChannel | { error: string }> {
  const { data: acc } = await admin.from("social_accounts").select("external_id").eq("id", accountId).maybeSingle();
  const adapter = adapters.youtube;
  if (!acc || !adapter) return { error: "YouTube がつながっていません。" };
  const account = await loadAccount(admin, accountId, acc.external_id, {}, adapter).catch(() => null);
  if (!account) return { error: `YouTube とのつながりが切れています。${RECONNECT}` };
  try {
    const channel = await fetchMyChannel(account.accessToken);
    if (!channel || channel.id !== acc.external_id) return { error: `つないだ YouTube のチャンネルが見つかりません。${RECONNECT}` };
    return channel;
  } catch (e) {
    if (e instanceof YouTubeApiError && (e.status === 401 || e.status === 403)) return { error: `YouTube とのつながりが切れています。${RECONNECT}` };
    console.error("[youtube] チャンネルを読めませんでした", e instanceof Error ? e.message : e);
    return { error: "YouTube のチャンネルを読めませんでした。時間をおいてもう一度お試しください。" };
  }
}

// 保存の前の確かめ。だめなら理由
export async function checkYouTubeChoice(admin: Admin, accountId: string, choice: YouTubeChoice | undefined): Promise<CheckedYouTube | { error: string }> {
  const problem = youtubeChoiceProblem(choice);
  if (problem) return { error: problem };
  const channel = await youtubeChannelFor(admin, accountId);
  if ("error" in channel) return channel;
  return { choice: choice!, channel };
}

// 同意の記録を書く（保存のあと。送信ジョブはこの記録を送る直前に照らす）。
// 書き直したら、まだ上げ終えていないアップロードの途中の情報は捨てる（前の同意の中身で始めたセッションを使わない）
export async function writeYouTubeConsent(
  admin: Admin,
  args: { userId: string; postId: string; title: string; text: string; checked: CheckedYouTube; now?: Date },
): Promise<void> {
  const { data: target, error } = await admin.from("post_targets").select("id").eq("post_id", args.postId).eq("owner_id", args.userId).eq("sns", "youtube").single();
  if (error) throw error;
  const now = (args.now ?? new Date()).toISOString();
  const c = args.checked.choice;
  const { error: e2 } = await admin.from("post_target_youtube").upsert({
    post_target_id: target.id,
    owner_id: args.userId,
    privacy_status: c.privacyStatus!,
    made_for_kids: c.madeForKids!,
    synthetic_media: c.syntheticMedia,
    category_id: c.categoryId,
    consented_at: now,
    consent_text_hash: consentHash(args.title, args.text),
    consent_channel: args.checked.channel.title,
    updated_at: now,
  });
  if (e2) throw e2;
  const { error: e3 } = await admin.from("youtube_uploads").delete().eq("post_target_id", target.id).is("video_id", null);
  if (e3) throw e3;
}

// 画面に戻す（下書きの再開・投稿の画面）。本人の配信先だけ（呼ぶ側で本人の投稿であることを確かめておく）
export async function youtubeChoiceOf(admin: Admin, postId: string, userId: string): Promise<YouTubeChoice | null> {
  const { data: t } = await admin.from("post_targets").select("id").eq("post_id", postId).eq("owner_id", userId).eq("sns", "youtube").maybeSingle();
  if (!t) return null;
  const { data: s } = await admin.from("post_target_youtube").select("privacy_status, made_for_kids, synthetic_media, category_id").eq("post_target_id", t.id).eq("owner_id", userId).maybeSingle();
  if (!s) return null;
  return { privacyStatus: s.privacy_status as YouTubeChoice["privacyStatus"], madeForKids: s.made_for_kids, syntheticMedia: s.synthetic_media, categoryId: s.category_id };
}
