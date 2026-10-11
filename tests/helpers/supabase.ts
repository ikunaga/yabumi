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

// テスト用の利用者を作ってログインする。確認メールを有効にしている（本番と同じ）ので、
// 画面からの登録ではなく、確認済みの利用者を secret キーで作る
export async function signUpNewUser(): Promise<{ client: TestClient; userId: string }> {
  const email = `rls-${randomUUID()}@example.com`;
  const password = "password-1234";
  const { data: created, error: createError } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw createError;
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client, userId: created.user.id };
}

export async function deleteUser(userId: string) {
  await adminClient().auth.admin.deleteUser(userId);
}
