import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { login } from "@/lib/auth/actions";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "ログイン" };

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const next = safeNextPath(searchParams.next);
  // メールのリンクが使えなかったとき（/auth/confirm から戻る）。confirm_failed は前の版の名前
  const initialError =
    searchParams.error === "link_invalid" || searchParams.error === "confirm_failed"
      ? "確認のリンクが無効か、期限切れです。もう一度ログインするか、登録をやり直してください。"
      : undefined;

  return <AuthForm mode="login" action={login} next={next} initialError={initialError} />;
}
