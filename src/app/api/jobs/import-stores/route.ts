import { NextResponse, type NextRequest } from "next/server";
import { credentialsConfigured } from "@/lib/crypto/credential-cipher";
import { isAuthorizedJob } from "@/lib/jobs/auth";
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
  const outcomes = await runStoreImports(createAdminClient(), { limit: 30, deadlineMs: Date.now() + 40_000 });
  if (outcomes.length) console.info("[jobs/import-stores]", JSON.stringify(outcomes));
  return NextResponse.json({ processed: outcomes.length, outcomes });
}
