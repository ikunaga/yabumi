import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { login } from "@/lib/auth/actions";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "ログイン" };

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const next = safeNextPath(searchParams.next);
  const initialError =
    searchParams.error === "confirm_failed" ? "確認リンクが無効か、期限切れです。もう一度お試しください。" : undefined;

  return <AuthForm mode="login" action={login} next={next} initialError={initialError} />;
}
