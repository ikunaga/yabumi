import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeByToken } from "@/lib/coach/unsubscribe";

// ワンクリックの配信の停止（RFC 8058。メールソフトの「配信停止」が List-Unsubscribe=One-Click を POST する）。docs/architecture.md の 4.27
export async function POST(request: NextRequest) {
  const ok = await unsubscribeByToken(request.nextUrl.searchParams.get("t"));
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
