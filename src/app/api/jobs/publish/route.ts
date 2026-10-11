import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { publisherDeps } from "@/lib/sns/adapters";
import { publishDueTargets } from "@/lib/sns/publisher";
import { createAdminClient } from "@/lib/supabase/admin";

// 1 回の実行で取り出す上限。画像の準備は待たない（準備中として次の回に続きを確かめる）ので、1 件は数秒で終わる。
// それでも時間が足りなければ、publishDueTargets が JOB_DEADLINE_MS（40 秒）で残りを次の回に回す。
// Vercel Hobby の関数の実行時間（60 秒）に収まる。見積もりは docs/architecture.md の 4.7「1 回のジョブの時間」
const LIMIT = 25;
export const maxDuration = 60;

// 予約時刻が来た投稿を送る。pg_cron から毎分呼ばれる
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const outcomes = await publishDueTargets(createAdminClient(), publisherDeps(), { limit: LIMIT });
  if (outcomes.length) console.info("[jobs/publish]", JSON.stringify(outcomes.map(({ targetId, sns, result }) => ({ targetId, sns, result }))));
  return NextResponse.json({ processed: outcomes.length, outcomes });
}
