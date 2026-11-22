import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isOperatorUser } from "./operator";

// ログインしている人が運営者なら、そのメールアドレスを返す。ちがえば null（呼ぶ側は 404 にする）。
// JWT の中のメールアドレスではなく、Auth のサーバーに問い合わせた利用者（getUser）で、確認が済んでいるかも見る（L6）
export async function currentOperatorEmail(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return isOperatorUser(data.user) ? (data.user.email ?? null) : null;
}
