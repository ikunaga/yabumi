import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { runCommentDigest } from "@/lib/sns/comments/digest";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// コメントのまとめの通知（docs/architecture.md の 4.70）。pg_cron から毎日 19:00（日本時間）に呼ばれる。
// ログには件数と結果だけを出す（コメントの本文・名前は出さない）
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const outcomes = await runCommentDigest(createAdminClient());
  const count = (r: string) => outcomes.filter((o) => o.result === r).length;
  if (outcomes.length) console.info("[jobs/comment-digest]", JSON.stringify({ sent: count("sent"), off: count("off"), noDevice: count("no_device"), failed: count("failed") }));
  return NextResponse.json({ processed: outcomes.length });
}
