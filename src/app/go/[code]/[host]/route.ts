import { after, NextResponse, type NextRequest } from "next/server";
import { linkAllowedOnDomain } from "@/lib/links/domains";
import { YABUMI_HOST_SEGMENT } from "@/lib/links/host";
import { classifyRequest } from "@/lib/links/rules";
import { recordClick, resolveLink } from "@/lib/links/store";
import { createAdminClient } from "@/lib/supabase/admin";

// 短縮リンクの転送（docs/architecture.md の 4.22、決定 D20・D28）。<APP_URL>/go/<code>、go.yabumi.app/<code>、利用者のドメインの /<code> を、
// proxy が /go/<code>/<開いたホスト> に回す（ホストは proxy が毎回付け直す。矢書のホストは "_"）。
// ログインなしで届く（proxy の公開のパス。ログインの確認も飛ばして速くする）。
// 302 で転送し、ブラウザに覚えさせない（2 回目のクリックも届くように）。記録は応答を返したあと（after）に行う

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

function notFound() {
  return new NextResponse("このリンクは見つからないか、使われていません。", {
    status: 404,
    headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function handle(request: NextRequest, code: string, host: string, count: boolean) {
  const admin = createAdminClient();
  const link = await resolveLink(admin, code);
  if (!link || link.disabled) return notFound();
  // 利用者のドメイン（D28）で開かれたら、そのドメインのプロジェクトのリンクだけを開く（ほかの人のコードを、別の人のドメインで開けないように）
  if (host !== YABUMI_HOST_SEGMENT && !(await linkAllowedOnDomain(admin, link.projectId, host))) return notFound();

  if (count) {
    const userAgent = request.headers.get("user-agent");
    const { device, excluded } = classifyRequest({
      userAgent,
      purpose: request.headers.get("sec-purpose") ?? request.headers.get("purpose"),
    });
    const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const country = request.headers.get("x-vercel-ip-country");
    after(async () => {
      try {
        await recordClick(admin, { linkId: link.id, ip, userAgent, device, country, excluded });
      } catch (e) {
        // 記録に失敗しても、転送は済んでいる（数え漏れ 1 件で済む）
        console.error("[go] クリックを記録できませんでした", e instanceof Error ? e.message : e);
      }
    });
  }

  return NextResponse.redirect(link.target, { status: 302, headers: NO_STORE });
}

export async function GET(request: NextRequest, ctx: RouteContext<"/go/[code]/[host]">) {
  const { code, host } = await ctx.params;
  return handle(request, code, host, true);
}

// HEAD はリンクの確かめ（プレビューのクローラーなど）なので数えない
export async function HEAD(request: NextRequest, ctx: RouteContext<"/go/[code]/[host]">) {
  const { code, host } = await ctx.params;
  return handle(request, code, host, false);
}
