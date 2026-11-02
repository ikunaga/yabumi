import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// 今すぐ送っている間に、画面が送り先ごとの状態を読む（4.36）。本人の投稿だけ（RLS）。
// server action は 1 つずつしか動かないので（送っている間は次を呼べない）、読むのはこの GET で
export async function GET(_req: Request, { params }: RouteContext<"/api/posts/[postId]/progress">) {
  const { postId } = await params;
  if (!z.uuid().safeParse(postId).success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabase.from("post_targets").select("sns, status").eq("post_id", postId);
  if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
  return NextResponse.json({ targets: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
