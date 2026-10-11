import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { signup } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "新規登録" };

export default function SignupPage() {
  return <AuthForm mode="signup" action={signup} />;
}
