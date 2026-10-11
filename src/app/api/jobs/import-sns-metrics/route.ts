import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { runSnsMetricsImport } from "@/lib/metrics/sns-import";
import { facebookAppSecret } from "@/lib/sns/facebook/config";
import { facebookInsights, instagramInsights, threadsInsights } from "@/lib/sns/insights";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// SNS の数字の取り込み（docs/architecture.md の 4.22）。pg_cron から毎日 5:00〜5:50 に 6 回呼ばれる。
// 1 回で 40 秒を過ぎたら新しいものに手をつけず、残りは次の回
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const outcomes = await runSnsMetricsImport(createAdminClient(), {
    fetchers: { threads: threadsInsights, instagram: instagramInsights, facebook: facebookInsights(facebookAppSecret) },
    deadlineMs: Date.now() + 40_000,
  });
  const failed = outcomes.filter((o) => o.result === "failed");
  if (outcomes.length) console.info("[jobs/import-sns-metrics]", JSON.stringify({ saved: outcomes.filter((o) => o.result === "saved").length, failed }));
  return NextResponse.json({ processed: outcomes.length, failed: failed.length });
}
