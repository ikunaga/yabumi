import { NextResponse, type NextRequest } from "next/server";
import { credentialsConfigured } from "@/lib/crypto/credential-cipher";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { googlePlayConfigured } from "@/lib/stores/google";
import { cleanupOrphanServiceAccounts, runPlayAndViewsImports } from "@/lib/stores/play-store";
import { runStoreImports } from "@/lib/stores/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// ストアと課金の取り込み（docs/architecture.md の 4.22）。pg_cron から毎日 3:00〜3:20 に 3 回呼ばれる。
// 1 回で 40 秒を過ぎたら新しい鍵には手をつけず、残りは次の回（取り込みの済んでいない古い順に読む）
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!credentialsConfigured()) return NextResponse.json({ processed: 0, skipped: "CREDENTIAL_ENCRYPTION_KEY が未設定" });
  const admin = createAdminClient();
  const deadlineMs = Date.now() + 40_000;
  const outcomes = await runStoreImports(admin, { limit: 30, deadlineMs });
  // Google Play と App Store のストアのページの閲覧数（段取り ⑤）
  const more = await runPlayAndViewsImports(admin, { limit: 30, deadlineMs });
  // 退会やプロジェクトの削除で記録だけが消えた、Google の側の読み取り用のアカウントを消す
  if (googlePlayConfigured() && Date.now() < deadlineMs) {
    await cleanupOrphanServiceAccounts(admin).catch((e) => console.error("[jobs/import-stores] アカウントの片付けに失敗しました", e instanceof Error ? e.message : e));
  }
  if (outcomes.length || more.length) console.info("[jobs/import-stores]", JSON.stringify({ outcomes, more }));
  return NextResponse.json({ processed: outcomes.length + more.length });
}
