import { NextResponse, type NextRequest } from "next/server";
import { engineDeps, runAutoPostJob } from "@/lib/auto-post/engine";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// 自動の投稿のジョブ（docs/design/auto-post.md の 2.3）。pg_cron から 10 分ごとに呼ばれる。
// 1 回に作るのは 5 回分まで（AI 1 回 5〜15 秒。Vercel の関数の 60 秒に収める）。
// 環境変数 AUTO_POST_ENABLED が "true" のときだけ動く（既定は止まっている。法務の了承と deploy.md の 31 の段取りが済むまで本番でも入れない。
// 止めると、新しい回は作らない。作り終えた予約は、いまの送信ジョブがそのまま送る）
export const maxDuration = 60;
const LIMIT = 5;

export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.AUTO_POST_ENABLED !== "true") return NextResponse.json({ skipped: "disabled" });
  const admin = createAdminClient();
  const deps = engineDeps(admin);
  if (!deps) return NextResponse.json({ skipped: "ai_not_configured" });
  const summary = await runAutoPostJob(admin, deps, { limit: LIMIT });
  // 件数だけを出す（本文・利用者の情報は出さない）
  console.info("[jobs/auto-post]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
