import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ログイン中のユーザーを返す。未ログインなら /login へ送る
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect("/login");
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
}
