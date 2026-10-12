import { NextResponse, type NextRequest } from "next/server";
import { runCoachJob } from "@/lib/coach/job";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// 伴走の毎日のジョブ（docs/architecture.md の 4.27）。pg_cron から日本時間 7:00 に呼ばれる。
// 50 秒を過ぎたら残りのプロジェクトには手をつけない（次の日に。送った記録があるので、同じ知らせは二重に送らない）
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const outcomes = await runCoachJob(createAdminClient(), { deadlineMs: Date.now() + 50_000 });
  const sent = outcomes.filter((o) => o.behind || o.weekly);
  if (sent.length) console.info("[jobs/coach]", JSON.stringify(sent));
  return NextResponse.json({ processed: outcomes.length, notified: sent.length });
}
