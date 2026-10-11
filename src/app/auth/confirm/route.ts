import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["email", "signup", "recovery", "email_change", "invite", "magiclink"];

// メールのリンクから戻ってきたときの受け口（docs/architecture.md の 4.16）。
// 矢書のメールのテンプレート（supabase/templates）は token_hash と type を付けて直接ここへ来る。
// 別の端末で開いても使えるよう、こちらを基本にしている。
// Supabase の既定のテンプレートのまま（本番で貼り忘れたときなど）は、Supabase で確かめたあと ?code= 付きで来るので、それも受ける
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const supabase = await createClient();

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  const url = new URL(type === "recovery" ? "/forgot-password" : "/login", request.url);
  url.searchParams.set("error", "link_invalid");
  return NextResponse.redirect(url);
}
