import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { toYmd } from "@/lib/time";
import { summarizeTrends, type TimeTrends } from "./time-bands";

// 時間帯ごとの傾向を読む（DB の posting_time_trends。直近 90 日。持ち主でなければ何も返らない）
export async function loadTimeTrends(projectId: string, db?: SupabaseClient<Database>, today = toYmd(new Date())): Promise<TimeTrends> {
  const supabase = db ?? (await createClient());
  const { data, error } = await supabase.rpc("posting_time_trends", { p_project_id: projectId, p_today: today });
  if (error) throw error;
  return summarizeTrends((data ?? []).map((r) => ({ band: r.band, posts: Number(r.posts), avgViews: r.avg_views === null ? null : Number(r.avg_views), clicks: Number(r.clicks) })));
}
