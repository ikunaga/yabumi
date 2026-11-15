import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// 太平洋時間で、その時刻が 0 時から何ミリ秒たっているか
function pacificSinceMidnight(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 + at.getMilliseconds();
}

// その時刻を含む日の、太平洋時間の 0 時。夏時間の切り替わりの日は、引いた先の時差が違うので、0 時になるまで直す
function pacificMidnight(at: Date): Date {
  let start = new Date(at.getTime() - pacificSinceMidnight(at));
  for (let i = 0; i < 2; i++) {
    const off = pacificSinceMidnight(start);
    if (off === 0) break;
    start = new Date(off >= 12 * 3600_000 ? start.getTime() + (24 * 3600_000 - off) : start.getTime() - off);
  }
  return start;
}

// YouTube の割り当ての 1 日（太平洋時間。reserve_youtube_upload と同じ区切り。docs/design/youtube.md の 6.）。夏時間の切り替わりの日は 23・25 時間
export function pacificDayRange(at: Date): { start: Date; end: Date } {
  const start = pacificMidnight(at);
  const end = pacificMidnight(new Date(start.getTime() + 26 * 3600_000));
  return { start, end };
}

// その日（太平洋時間）に YouTube へ送る予定の、本人の投稿の数（RLS で本人の行だけ）。送れなかった・手で投稿する・取り消したものは数えない。
// excludePostId: いま保存している投稿（数え直さない）
export async function youtubeSchedulesOnDay(supabase: SupabaseClient<Database>, at: Date, excludePostId: string | null): Promise<number> {
  const { start, end } = pacificDayRange(at);
  let query = supabase
    .from("post_targets")
    .select("id, posts!inner(id, status, planned_at)", { count: "exact", head: true })
    .eq("sns", "youtube")
    .in("status", ["pending", "preparing", "publishing", "published"])
    .eq("posts.status", "scheduled")
    .gte("posts.planned_at", start.toISOString())
    .lt("posts.planned_at", end.toISOString());
  if (excludePostId) query = query.neq("post_id", excludePostId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}
