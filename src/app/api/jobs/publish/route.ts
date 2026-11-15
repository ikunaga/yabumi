import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { publisherDeps } from "@/lib/sns/adapters";
import { publishDueTargets } from "@/lib/sns/publisher";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkYouTubeProcessing } from "@/lib/sns/youtube/processing";

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
  const admin = createAdminClient();
  const deps = publisherDeps();
  const outcomes = await publishDueTargets(admin, deps, { limit: LIMIT });
  if (outcomes.length) console.info("[jobs/publish]", JSON.stringify(outcomes.map(({ targetId, sns, result }) => ({ targetId, sns, result }))));
  // YouTube に上げた動画の、YouTube での処理の確かめ（docs/design/youtube.md の 3.4）。失敗しても送信の結果は返す
  let processing: Awaited<ReturnType<typeof checkYouTubeProcessing>> = [];
  try {
    processing = await checkYouTubeProcessing(admin, deps.adapters.youtube, deps);
    const changed = processing.filter((o) => o.result === "failed" || o.result === "ok");
    if (changed.length) console.info("[jobs/publish] youtube processing", JSON.stringify(changed.map(({ targetId, result }) => ({ targetId, result }))));
  } catch (e) {
    console.error("[jobs/publish] YouTube の処理を確かめられませんでした", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ processed: outcomes.length, outcomes, youtubeProcessing: processing.length });
}
