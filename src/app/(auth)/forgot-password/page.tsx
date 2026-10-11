import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { requestPasswordReset } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "パスワードの再設定" };

export default async function ForgotPasswordPage(props: PageProps<"/forgot-password">) {
  const { error } = await props.searchParams;
  const initialError = error === "link_invalid" ? "再設定のリンクが無効か、期限切れです。もう一度メールを送ってください。" : undefined;
  return <AuthForm mode="forgot" action={requestPasswordReset} initialError={initialError} />;
}
