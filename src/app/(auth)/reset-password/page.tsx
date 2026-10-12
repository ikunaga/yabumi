import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { updatePassword } from "@/lib/auth/actions";
import { hasConsented } from "@/lib/legal/consent";
import { currentLegalVersion, effectiveDateLabel } from "@/lib/legal/version";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "新しいパスワード" };

// 再設定のメールのリンク（/auth/confirm）から来る。リンクを開いた時点でログインした状態になっている（proxy がログインを求める）。
// 招待のメールからも来る（パスワードを決めて始める）。いまの版の規約・ポリシーに同意していなければ、同意のチェックを出す（決定 D31）
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  let needsConsent = false;
  try {
    needsConsent = Boolean(data.user) && !(await hasConsented(supabase, currentLegalVersion()));
  } catch (e) {
    console.error("[reset-password] 同意の記録を読めませんでした", e instanceof Error ? e.message : e);
  }
  return (
    <AuthForm
      mode="reset"
      action={updatePassword}
      // 招待の利用者でまだ同意していなければ、招待のメールから始めるところ（招待のリンクを開いた時点でログインした扱いになるので、ログインの日時では見分けない）
      consent={needsConsent ? { effectiveDate: effectiveDateLabel(), invited: Boolean(data.user?.invited_at) } : null}
    />
  );
}
