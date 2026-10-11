import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirect } from "@/lib/canonical-host";
import { shortLinkRoute } from "@/lib/links/host";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // 短縮リンク（go.yabumi.app/<code> と <APP_URL>/go/<code>）は、独自ドメインへの転送とログインの確認より先に処理する（4.22）。
  // ログインの確認（Supabase への問い合わせ）を飛ばして、転送を速くする
  const short = shortLinkRoute(request.nextUrl, process.env.SHORT_LINK_BASE_URL, process.env.APP_URL);
  if (short?.type === "rewrite") return NextResponse.rewrite(short.url);
  if (short?.type === "redirect") return NextResponse.redirect(short.url, 302);
  if (short?.type === "pass") return NextResponse.next();

  // 本番の vercel.app のアドレスで開かれたら、APP_URL（独自ドメイン）へ転送する
  const to = canonicalRedirect(request.nextUrl, { appUrl: process.env.APP_URL, vercelEnv: process.env.VERCEL_ENV });
  if (to) return NextResponse.redirect(to, 308);
  return updateSession(request);
}

export const config = {
  // 静的ファイルと画像、アイコン・マニフェスト（ログイン前の画面でもブラウザが読む）は除外する
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
