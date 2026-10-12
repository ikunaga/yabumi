import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { defaultLinkDomainDeps, drainLinkDomainRemovals, recheckLinkDomains } from "@/lib/links/domains";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// 短縮リンクの利用者のドメインの見回り（docs/architecture.md の 4.22、D28）。pg_cron から毎日呼ばれる。
// つながったドメインの DNS（矢書の持ち主の確認の TXT と CNAME）がまだ残っているかを確かめて、外れていたら矢書のドメインに戻し、
// つながらないまま 7 日たったものを取り消し、外す途中のものを Vercel から外す
export async function POST(request: NextRequest) {
  if (!isAuthorizedJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const deps = defaultLinkDomainDeps();
  const report = await recheckLinkDomains(admin, deps);
  const removed = await drainLinkDomainRemovals(admin, deps).catch((e) => {
    console.error("[jobs/check-link-domains] Vercel から外せませんでした", e instanceof Error ? e.message : e);
    return 0;
  });
  if (report.lost || report.expired || removed) console.info("[jobs/check-link-domains]", JSON.stringify({ ...report, removed }));
  return NextResponse.json({ ...report, removed });
}
