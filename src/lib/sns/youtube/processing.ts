import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loadAccount, type PublisherDeps } from "@/lib/sns/publisher";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import { fetchVideoProcessing, type VideoProcessing } from "./api";

// 送ったあとの処理の確かめ（docs/design/youtube.md の 3.4）。アップロードが済んで published にした動画を、
// processing_check_until まで送信ジョブのたびに読み、YouTube が受け付けなかったら配信先を失敗にして要確認に出す
type Admin = SupabaseClient<Database>;

export type ProcessingOutcome = { targetId: string; result: "ok" | "processing" | "failed" | "skipped"; message?: string };

// 1 回のジョブで確かめる数（1 本 1 ユニット。10,000 ユニットの枠の中）
const CHECK_LIMIT = 10;

// YouTube の rejectionReason・failureReason を、利用者向けの文にする
export function processingFailureMessage(p: VideoProcessing): string | null {
  if (p.uploadStatus === "rejected") {
    const why: Record<string, string> = {
      duplicate: "同じ動画がもうチャンネルにあるため",
      copyright: "著作権の申し立てがあったため",
      inappropriate: "YouTube のガイドラインに合わないと判断されたため",
      length: "動画が長すぎるため",
      uploaderAccountSuspended: "チャンネルが停止されているため",
      uploaderAccountClosed: "チャンネルが閉じられているため",
      termsOfUse: "YouTube の利用規約に合わないと判断されたため",
      trademark: "商標の申し立てがあったため",
      claim: "権利の申し立てがあったため",
    };
    return `YouTube が動画を受け付けませんでした（${why[p.rejectionReason] ?? "理由は YouTube Studio で確認してください"}）。YouTube Studio で確認してください。`;
  }
  if (p.uploadStatus === "failed" || p.processingStatus === "failed" || p.processingStatus === "terminated") {
    const why: Record<string, string> = {
      codec: "動画の形式を読めなかったため",
      conversion: "動画を変換できなかったため",
      emptyFile: "動画のファイルが空だったため",
      invalidFile: "動画のファイルが壊れていたため",
      tooSmall: "動画が小さすぎるため",
      uploadAborted: "アップロードが途中で止まったため",
    };
    return `YouTube で動画の処理に失敗しました（${why[p.failureReason] ?? "理由は YouTube Studio で確認してください"}）。動画を添え直して送り直すか、YouTube Studio で確認してください。`;
  }
  return null;
}

export async function checkYouTubeProcessing(admin: Admin, adapter: SnsAdapter | undefined, deps: Pick<PublisherDeps, "key" | "now" | "refreshWait" | "onlyOwner">): Promise<ProcessingOutcome[]> {
  if (!adapter) return [];
  const now = deps.now?.() ?? new Date();
  let query = admin
    .from("youtube_uploads")
    .select("post_target_id, owner_id, video_id")
    .not("video_id", "is", null)
    .gt("processing_check_until", now.toISOString())
    .order("processing_check_until")
    .limit(CHECK_LIMIT);
  if (deps.onlyOwner) query = query.eq("owner_id", deps.onlyOwner);
  const { data, error } = await query;
  if (error) throw error;

  const outcomes: ProcessingOutcome[] = [];
  for (const row of data ?? []) {
    const stop = async () => {
      const { error: e } = await admin.from("youtube_uploads").update({ processing_check_until: null, updated_at: now.toISOString() }).eq("post_target_id", row.post_target_id);
      if (e) throw e;
    };
    const { data: t } = await admin
      .from("post_targets")
      .select("id, status, social_account_id, social_accounts(external_id, status)")
      .eq("id", row.post_target_id)
      .maybeSingle();
    const acc = t?.social_accounts as unknown as { external_id: string; status: string } | null;
    // 取り消した・つながっていない配信先は、もう確かめない
    if (!t || t.status !== "published" || !t.social_account_id || !acc || acc.status !== "active") {
      await stop();
      outcomes.push({ targetId: row.post_target_id, result: "skipped" });
      continue;
    }
    try {
      const account = await loadAccount(admin, t.social_account_id, acc.external_id, deps, adapter);
      if (!account) {
        await stop();
        outcomes.push({ targetId: row.post_target_id, result: "skipped" });
        continue;
      }
      const p = await fetchVideoProcessing(account.accessToken, row.video_id!);
      const message = p ? processingFailureMessage(p) : "YouTube に動画が見つかりませんでした。YouTube Studio で確認してください。";
      if (message) {
        const { error: e } = await admin.from("post_targets").update({ status: "failed", error_message: message }).eq("id", t.id).eq("status", "published");
        if (e) throw e;
        // 送り直したら、新しく上げ直す（受け付けられなかった動画の ID を「上げ終えた印」として残さない）
        const { error: e2 } = await admin.from("youtube_uploads").delete().eq("post_target_id", row.post_target_id);
        if (e2) throw e2;
        outcomes.push({ targetId: row.post_target_id, result: "failed", message });
      } else if (p!.uploadStatus === "processed" && (p!.processingStatus === "succeeded" || p!.processingStatus === "")) {
        await stop();
        outcomes.push({ targetId: row.post_target_id, result: "ok" });
      } else {
        outcomes.push({ targetId: row.post_target_id, result: "processing" });
      }
    } catch (e) {
      // 読めなかったときは次の回にもう一度（確かめの期限が来たら、published のまま終わる）
      outcomes.push({ targetId: row.post_target_id, result: "processing", message: e instanceof Error ? e.message : String(e) });
    }
  }
  return outcomes;
}
