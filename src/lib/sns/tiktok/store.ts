import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TikTokTarget } from "@/lib/sns/adapters/tiktok";
import type { TikTokSettings } from "./publish";

// TikTok の配信先の、タイトルと同意の記録（post_target_tiktok）。サーバーの権限で読み書きする（利用者の権限では読めない）
type Admin = SupabaseClient<Database>;

export async function loadTikTokTarget(admin: Admin, postTargetId: string): Promise<TikTokTarget | null> {
  const { data: t } = await admin.from("post_targets").select("owner_id, title, sns").eq("id", postTargetId).maybeSingle();
  if (!t || t.sns !== "tiktok") return null;
  const { data: s } = await admin.from("post_target_tiktok").select("*").eq("post_target_id", postTargetId).eq("owner_id", t.owner_id).maybeSingle();
  return { ownerId: t.owner_id, title: t.title ?? "", settings: s ? (s as unknown as TikTokSettings) : null };
}
