import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirect } from "@/lib/canonical-host";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // 本番の vercel.app のアドレスで開かれたら、APP_URL（独自ドメイン）へ転送する
  const to = canonicalRedirect(request.nextUrl, { appUrl: process.env.APP_URL, vercelEnv: process.env.VERCEL_ENV });
  if (to) return NextResponse.redirect(to, 308);
  return updateSession(request);
}

export const config = {
  // 静的ファイルと画像、アイコン・マニフェスト（ログイン前の画面でもブラウザが読む）は除外する
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
