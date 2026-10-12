import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// 利用規約とプライバシーポリシーへの同意の記録（決定 D31。docs/legal.md の「施行したあとの変え方」）。
// 版は施行日の ISO 日付（src/lib/legal/version.ts の currentLegalVersion だけを使う）

type Db = SupabaseClient<Database>;

export type ConsentVia = "signup" | "invite" | "login" | "change";

// 本人がその版に同意しているか（RLS で本人の記録だけ）
export async function hasConsented(db: Db, version: string): Promise<boolean> {
  const { data, error } = await db.from("legal_consents").select("id").eq("version", version).limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// 同意をどこでしたか: 前の版に同意していれば再同意（change）、招待から始めてまだ同意がなければ invite、ほかは login
export async function consentVia(db: Db, invited: boolean): Promise<ConsentVia> {
  const { count, error } = await db.from("legal_consents").select("id", { count: "exact", head: true });
  if (error) throw error;
  if ((count ?? 0) > 0) return "change";
  return invited ? "invite" : "login";
}

// 本人の同意を記録する（日時は DB が入れる。同じ版は 1 回だけ）
export async function recordConsent(db: Db, version: string, via: ConsentVia): Promise<void> {
  const { error } = await db.from("legal_consents").insert({ version, via });
  // 23505: もう同じ版に同意している
  if (error && error.code !== "23505") throw error;
}
