import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { publisherDeps } from "@/lib/sns/adapters";
import { refreshDueTokens } from "@/lib/sns/publisher";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeExpiredYouTube } from "@/lib/sns/youtube/purge";

export const maxDuration = 60;

// 期限が近い SNS のトークンを延長する。pg_cron から毎日呼ばれる
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const outcomes = await refreshDueTokens(admin, publisherDeps());
  if (outcomes.length) console.info("[jobs/refresh-tokens]", JSON.stringify(outcomes));
  // 期限切れのまま 30 日たった YouTube のアカウントのデータを消す（docs/design/youtube.md の 9.）。件数だけをログに出す
  let purged = 0;
  try {
    purged = (await purgeExpiredYouTube(admin)).length;
    if (purged) console.info("[jobs/refresh-tokens] youtube purged", purged);
  } catch (e) {
    console.error("[jobs/refresh-tokens] YouTube の期限切れのデータを消せませんでした", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ processed: outcomes.length, outcomes, youtubePurged: purged });
}
