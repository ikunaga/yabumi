import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { facebookAppSecret } from "@/lib/sns/facebook/config";
import { adapters } from "@/lib/sns/adapters";
import { facebookComments, instagramComments, threadsComments } from "@/lib/sns/comments/fetchers";
import { runSnsCommentsImport } from "@/lib/sns/comments/import";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// SNS のコメントの取り込み（docs/architecture.md の 4.70）。pg_cron から 3 時間ごとに、15・25・35 分の 3 回呼ばれる。
// 1 回で 40 秒を過ぎたら新しいものに手をつけず、残りは次の回。ログには件数と状態だけを出す（コメントの本文・名前は出さない）
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const outcomes = await runSnsCommentsImport(createAdminClient(), {
    fetchers: { threads: threadsComments, instagram: instagramComments, facebook: facebookComments(facebookAppSecret) },
    adapters,
    deadlineMs: Date.now() + 40_000,
  });
  const count = (r: string) => outcomes.filter((o) => o.result === r).length;
  // 失敗の中身は分類のコードだけを出す（外部の API のエラー文には、相手の返した文や URL が入ることがある。セキュリティ確認の R3）
  const failed = outcomes.filter((o) => o.result === "failed" || o.result === "stopped").map((o) => ({ id: o.id, sns: o.sns, result: o.result, code: o.code ?? "other" }));
  if (outcomes.length) {
    console.info("[jobs/import-sns-comments]", JSON.stringify({ saved: count("saved"), unchanged: count("unchanged"), skipped: count("skipped"), failed }));
  }
  return NextResponse.json({ processed: outcomes.length, failed: failed.length });
}
