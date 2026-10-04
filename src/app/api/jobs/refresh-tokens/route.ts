import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { adapters } from "@/lib/sns/adapters";
import { refreshDueTokens } from "@/lib/sns/publisher";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// 期限が近い SNS のトークンを延長する。pg_cron から毎日呼ばれる
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const outcomes = await refreshDueTokens(createAdminClient(), { adapters });
  if (outcomes.length) console.info("[jobs/refresh-tokens]", JSON.stringify(outcomes));
  return NextResponse.json({ processed: outcomes.length, outcomes });
}
