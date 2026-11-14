import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// コメントを表示したあとに「見た」にする（docs/architecture.md の 4.70）。見た時刻は DB の関数が決め、本人の行だけを変える。
// server action にしないのは、action のあとに画面が読み直され、表示したその回の「● 新しい」が消えてしまうため。
// 本文は JSON だけを受け取る（ほかのサイトのフォームからは送れない形。変わるのは見た時刻だけ）
const Body = z.object({ projectId: z.uuid(), postId: z.uuid().optional() });

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "bad request" }, { status: 415 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { projectId, postId } = parsed.data;
  const { data, error } = await supabase.rpc("mark_sns_comments_seen", { p_project_id: projectId, ...(postId ? { p_post_id: postId } : {}) });
  if (error) {
    console.error("[comments] mark seen", error.code);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  return NextResponse.json({ marked: data ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
