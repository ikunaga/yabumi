import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { adapters } from "@/lib/sns/adapters";
import { publishDueTargets } from "@/lib/sns/publisher";
import { createAdminClient } from "@/lib/supabase/admin";

// 1 回の実行で送る上限。Vercel Hobby の関数の実行時間（60 秒）に収める
const LIMIT = 10;
export const maxDuration = 60;

// 予約時刻が来た投稿を送る。pg_cron から毎分呼ばれる
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const outcomes = await publishDueTargets(createAdminClient(), { adapters }, { limit: LIMIT });
  if (outcomes.length) console.info("[jobs/publish]", JSON.stringify(outcomes.map(({ targetId, sns, result }) => ({ targetId, sns, result }))));
  return NextResponse.json({ processed: outcomes.length, outcomes });
}
