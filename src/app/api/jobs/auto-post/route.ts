import { after, NextResponse, type NextRequest } from "next/server";
import { engineDeps, runAutoPostJob } from "@/lib/auto-post/engine";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// 自動の投稿のジョブ（docs/design/auto-post.md の 2.3）。pg_cron から 10 分ごとに呼ばれる。
// 1 回のジョブで作るのは 1 回分（シリーズ・確認・画像まで続けると 1 回分で 35〜75 秒かかる。2026-11-24 本番で 60 秒をこえて打ち切られ、
// 3 回取り直したあとに黙って飛ばした）。関数の時間は 300 秒（Vercel の Fluid compute では Hobby でも既定・上限が 300 秒。
// https://vercel.com/docs/functions/configuring-functions/duration）。始めから 200 秒をこえたら新しい回は取らない（時間の見張り）。
// 環境変数 AUTO_POST_ENABLED が "true" のときだけ動く（既定は止まっている。法務の了承と deploy.md の 31 の段取りが済むまで本番でも入れない。
// 止めると、新しい回は作らない。作り終えた予約は、いまの送信ジョブがそのまま送る）
export const maxDuration = 300;
const LIMIT = 1;
const DEADLINE_MS = 200_000;

export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  if (process.env.AUTO_POST_ENABLED !== "true") return NextResponse.json({ skipped: "disabled" });
  const admin = createAdminClient();
  const deps = engineDeps(admin);
  if (!deps) return NextResponse.json({ skipped: "ai_not_configured" });
  // 先に返事をしてから作る（after）。呼ぶ側（pg_cron の invoke_job）は 55 秒で待つのをやめるので、それより長くかかっても途中で切れないように。
  // after は route の maxDuration（300 秒）まで動ける（node_modules/next/dist/docs の after.md）
  after(async () => {
    try {
      const summary = await runAutoPostJob(admin, deps, { limit: LIMIT, deadline: startedAt + DEADLINE_MS });
      // 件数だけを出す（本文・利用者の情報は出さない）
      console.info("[jobs/auto-post]", JSON.stringify(summary));
    } catch (e) {
      console.error("[jobs/auto-post] ジョブが失敗しました", e instanceof Error ? e.message : e);
    }
  });
  return NextResponse.json({ accepted: true });
}
