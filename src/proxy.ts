import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirect } from "@/lib/canonical-host";
import { shortLinkRoute } from "@/lib/links/host";
import { LAST_PROJECT_COOKIE, LAST_PROJECT_COOKIE_OPTIONS, lastProjectChange } from "@/lib/projects/last-project";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // 短縮リンク（go.yabumi.app/<code>、<APP_URL>/go/<code>、利用者のドメインの /<code>）は、独自ドメインへの転送とログインの確認より先に処理する（4.22）。
  // ログインの確認（Supabase への問い合わせ）を飛ばして、転送を速くする
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const short = shortLinkRoute(request.nextUrl, process.env.SHORT_LINK_BASE_URL, process.env.APP_URL, host);
  if (short?.type === "rewrite") {
    return NextResponse.rewrite(new URL(short.pathname + request.nextUrl.search, request.url));
  }
  if (short?.type === "redirect") return NextResponse.redirect(short.url, 302);
  // 利用者のドメイン（4.22、D28）で、短縮リンクとつながりの確認以外のパス。yabumi の画面は出さない
  if (short?.type === "respond") {
    return new NextResponse(short.body, {
      status: short.status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  }

  // 本番の vercel.app のアドレスで開かれたら、APP_URL（独自ドメイン）へ転送する
  const to = canonicalRedirect(request.nextUrl, { appUrl: process.env.APP_URL, vercelEnv: process.env.VERCEL_ENV });
  if (to) return NextResponse.redirect(to, 308);
  const response = await updateSession(request);
  // 直前に開いていたプロジェクトを覚える・消す（用語集を、そのプロジェクトの上の帯のまま出すため。4.48）
  const change = lastProjectChange(request.nextUrl.pathname, request.headers);
  if (change === "clear") response.cookies.delete(LAST_PROJECT_COOKIE);
  else if (change) response.cookies.set(LAST_PROJECT_COOKIE, change.set, { ...LAST_PROJECT_COOKIE_OPTIONS, secure: request.nextUrl.protocol === "https:" });
  return response;
}

export const config = {
  // 静的ファイルと画像、アイコン・マニフェスト・service worker（ログイン前の画面でもブラウザが読む）は除外する
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|version.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
