import { NextResponse, type NextRequest } from "next/server";
import { sharedText } from "@/lib/notes/rules";
import { SHARE_COOKIE, SHARE_COOKIE_SECONDS, encodeShareCookie } from "@/lib/notes/share";

// ほかのアプリからの「共有」の受け口（manifest の share_target）。ふつうは service worker（public/sw.js）が先に受けるので、
// ここに届くのは service worker がまだ動いていないときだけ。本文だけを短い間 cookie に置き、/share を開く（画像は受け取れない）
export async function POST(request: NextRequest) {
  let text = "";
  let hadFile = false;
  try {
    const form = await request.formData();
    const s = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : null;
    };
    text = sharedText({ title: s("title"), text: s("text"), url: s("url") });
    hadFile = form.getAll("image").some((v) => typeof v !== "string" && v.size > 0);
  } catch {
    // 形の合わない送信は、空のメモとして開く
  }
  const res = NextResponse.redirect(new URL("/share", request.url), 303);
  res.cookies.set(SHARE_COOKIE, encodeShareCookie({ text, hadFile }), {
    path: "/",
    maxAge: SHARE_COOKIE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
  });
  return res;
}
