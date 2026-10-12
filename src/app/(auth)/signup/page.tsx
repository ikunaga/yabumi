import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { signup } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "新規登録" };

export default function SignupPage() {
  // 登録を閉じている（招待制。D24 の ②）ときは、招待の申し込みへ案内する（docs/architecture.md の 4.29）
  const closed = process.env.ALLOWED_SIGNUP_EMAILS !== undefined;
  return (
    <AuthForm
      mode="signup"
      action={signup}
      notice={
        closed && (
          <p className="rounded-md bg-primary-soft px-4 py-3 text-[14px] leading-7">
            いまは招待制です。招待のメールが届いた方は、メールのボタンから始めてください（ここでの登録はいりません）。まだの方は、
            <Link href="/#apply" className="font-semibold text-primary hover:underline">
              招待を申し込む
            </Link>
            からどうぞ。
          </p>
        )
      }
    />
  );
}
