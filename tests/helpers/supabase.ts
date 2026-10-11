// 結合テスト用。ローカルの Supabase（supabase start）が必要。URL とキーは .env.local から読む（./env.ts）
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { testEnv } from "./env";

export const url = testEnv("SUPABASE_TEST_URL", "NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = testEnv("SUPABASE_TEST_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
// RLS を通らないキー。ローカルの Supabase のもの（`supabase status` の Secret key）
const secretKey = testEnv("SUPABASE_TEST_SECRET_KEY", "SUPABASE_SECRET_KEY");

export type TestClient = SupabaseClient<Database>;

export function anonClient(): TestClient {
  return createClient<Database>(url, publishableKey, { auth: { persistSession: false } });
}

// RLS を通らないサーバー用のクライアント。OAuth の受け口がやることの代わりに使う
export function adminClient(): TestClient {
  return createClient<Database>(url, secretKey, { auth: { persistSession: false } });
}

// テスト用の利用者を作ってログインする。確認メールを有効にしている（本番と同じ）ので、画面からの登録ではなく、確認済みの利用者を secret キーで作る。
// パスワードは付けず、マジックリンク（メールは送らない）でログインする。パスワードの登録とログインは、認証サーバーでハッシュ（bcrypt）を 2 回計算するので、
// テストを並列で流すと認証サーバーが詰まり、利用者を作るところで 5〜10 秒の時間切れが起きていた（2026-10-11、README の「テスト」）
export async function signUpNewUser(): Promise<{ client: TestClient; userId: string }> {
  const email = `rls-${randomUUID()}@example.com`;
  const admin = adminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (createError) throw createError;
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw linkError;
  const client = anonClient();
  const { error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (error) throw error;
  return { client, userId: created.user.id };
}

// テストの利用者を消す。費用の記録（ai_usage、sns_api_usage）は利用者を消しても持ち主を空にして残る決まり（4.14）なので、先に消す。
// 残すと、共有のローカル DB で矢書全体の今月の合計が増え続け、全体の上限に達してオーナーが AI や X を使えなくなる
export async function deleteUser(userId: string) {
  const admin = adminClient();
  await admin.from("ai_usage").delete().eq("owner_id", userId);
  await admin.from("sns_api_usage").delete().eq("owner_id", userId);
  await admin.auth.admin.deleteUser(userId);
}
