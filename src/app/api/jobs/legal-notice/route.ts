import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { sendLegalNoticeBatch } from "@/lib/legal/notice-mail";
import { appUrl } from "@/lib/sns/threads/config";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// 利用規約・プライバシーポリシーの変更の知らせの続きを送る毎日のジョブ（決定 D31。docs/architecture.md の 4.30）。
// pg_cron から日本時間 9:10 に呼ばれる。運営者が「全員に送る」を押した予定の変更だけを、今日の残りの数まで送る。
// 50 秒を過ぎたら残りは次の日に（送った記録があるので、二重に送らない）
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const outcome = await sendLegalNoticeBatch(createAdminClient(), { appUrl: appUrl(), deadlineMs: Date.now() + 50_000 });
  if (outcome.sent || outcome.failed) console.info("[jobs/legal-notice]", JSON.stringify(outcome));
  return NextResponse.json(outcome);
}
