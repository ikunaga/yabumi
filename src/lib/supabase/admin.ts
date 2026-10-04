import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { supabaseUrl } from "./env";

// RLS を通らないサーバー専用のクライアント。OAuth の受け口と SNS からの通知だけで使う。
// 誰のデータかは呼び出し側で確かめてから渡すこと（owner_id を利用者の入力から取らない）。
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("環境変数 SUPABASE_SECRET_KEY が設定されていません。.env.example を参考に .env.local に追加してください。");
  }
  return createClient<Database>(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
