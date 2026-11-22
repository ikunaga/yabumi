// 運営者かどうか（招待の申し込みの一覧を見られる人。docs/architecture.md の 4.29）。
// OPERATOR_ADMIN_EMAILS（カンマ区切り）に、ログインしているメールアドレスが入っていれば運営者。未設定ならだれも運営者ではない
export function isOperatorEmail(email: string | null | undefined, raw: string | undefined = process.env.OPERATOR_ADMIN_EMAILS): boolean {
  if (!email || !raw) return false;
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

// 運営者かどうか（利用者の情報から）。メールアドレスの確認が済んでいない人は、アドレスが一覧にあっても運営者にしない
// （セキュリティ確認 2026-11-21 の L6。本番の Auth でメールの確認が切れていると、運営者のアドレスで登録した人が運営者の画面を開けたため）。
// email_confirmed_at は Auth のサーバーが付ける値（利用者が書き換えられる user_metadata の email_verified は見ない）
export function isOperatorUser(user: { email?: string | null; email_confirmed_at?: string | null } | null | undefined, raw: string | undefined = process.env.OPERATOR_ADMIN_EMAILS): boolean {
  if (!user?.email_confirmed_at) return false;
  return isOperatorEmail(user.email, raw);
}
