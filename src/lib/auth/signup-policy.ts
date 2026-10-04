// 新規登録を許すメールアドレス。ALLOWED_SIGNUP_EMAILS（カンマ区切り）が設定されていれば、それだけを通す。
// 未設定（ローカルの開発）なら誰でも登録できる。本番ではオーナーのアドレスだけを入れる（docs/deploy.md）。
// 公開キーで Supabase の登録 API を直接呼ばれると、ここは通らない。本番では Supabase 側でも新規登録を閉じる
export function isSignupAllowed(email: string, raw: string | undefined = process.env.ALLOWED_SIGNUP_EMAILS): boolean {
  if (raw === undefined) return true;
  const allowed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
