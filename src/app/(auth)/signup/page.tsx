import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { signup } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "新規登録" };

export default function SignupPage() {
  return (
    <>
      <AuthForm mode="signup" action={signup} />
      <p className="text-center text-xs leading-[1.7] text-muted">
        登録すると、
        <Link href="/terms" className="text-primary hover:underline">
          利用規約
        </Link>
        と
        <Link href="/privacy" className="text-primary hover:underline">
          プライバシーポリシー
        </Link>
        に同意したものとします。
      </p>
    </>
  );
}
