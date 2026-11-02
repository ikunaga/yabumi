import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// ログイン中のユーザーを返す。未ログインなら /login へ送る。
// レイアウトとページの両方から呼ぶので、1 回の表示では 1 回だけ確かめる（getClaims は署名鍵が HS256 だと毎回 Supabase に問い合わせる）
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect("/login");
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
});
