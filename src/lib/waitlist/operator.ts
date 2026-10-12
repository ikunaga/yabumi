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
