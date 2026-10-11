import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { cleanupMedia } from "@/lib/media/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// 画像の片付け（docs/architecture.md の 4.18）。pg_cron から毎日呼ばれる。
// 投稿に添えないまま 1 日たった画像、投稿が消えた画像、送り終えて 30 日たった画像、記録のないファイルを消す
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  let removed = 0;
  // 1 回で消すのは 200 件まで。多ければ 5 回まで続ける（残りは翌日）
  for (let i = 0; i < 5; i++) {
    const r = await cleanupMedia(admin);
    removed += r.removed;
    if (r.removed < 200) break;
  }
  if (removed) console.info("[jobs/cleanup-media]", removed);
  return NextResponse.json({ removed });
}
