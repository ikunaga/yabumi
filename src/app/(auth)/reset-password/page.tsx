import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { updatePassword } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "新しいパスワード" };

// 再設定のメールのリンク（/auth/confirm）から来る。リンクを開いた時点でログインした状態になっている（proxy がログインを求める）
export default function ResetPasswordPage() {
  return <AuthForm mode="reset" action={updatePassword} />;
}
