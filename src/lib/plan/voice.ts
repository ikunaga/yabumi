import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// 過去の自分の投稿から文調をそろえる（docs/design/voice-from-posts.md）。材料・例の投稿の読み込みと、AI に渡す形をここにまとめる
type Db = SupabaseClient<Database>;

// 自分で書いて送った投稿の本数（このプロジェクトの、送った配信先が 1 つでもある投稿のうち、本文を書いたのが AI でないもの。
// text_origin が null（列を足す前からある投稿）は、本人が書いたものとして数える）。利用者の権限で読む（RLS で本人のものだけ）
export async function countSelfWrittenPosts(db: Db, projectId: string): Promise<number> {
  const { count, error } = await db
    .from("posts")
    .select("id, post_targets!inner(id)", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("post_targets.status", "published")
    .or("text_origin.is.null,text_origin.eq.self");
  if (error) throw error;
  return count ?? 0;
}
