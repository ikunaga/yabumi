import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isUuid } from "@/lib/uuid";

// 直前に開いていたプロジェクト（docs/architecture.md の 4.48）。用語集（プロジェクトの外の画面）を、プロジェクトの中から開いたときに、
// そのプロジェクトの上の帯（切り替え・Overview〜More・スマホの下のタブ）のまま出すために使う。
// cookie には id だけを置き、信用しない: 用語集では必ず RLS の効く読み方で本人のものか確かめ、だめならプロジェクトの外の帯にする

export const LAST_PROJECT_COOKIE = "yabumi_last_project";
export const LAST_PROJECT_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 } as const;

// 画面の移動（proxy が受けるリクエスト）ごとに、cookie をどうするか。
// /projects/<id>（とその下）を開いたら覚え、プロジェクトの一覧・新しいプロジェクトを開いたら消す（一覧から開いた用語集は、外の帯のまま）。
// 先読み（prefetch）では変えない（一覧のカードの先読みで、開いていないプロジェクトを覚えないように）
export function lastProjectChange(pathname: string, headers: Headers): { set: string } | "clear" | null {
  if (headers.get("next-router-prefetch") || /prefetch/i.test(headers.get("sec-purpose") ?? headers.get("purpose") ?? "")) return null;
  if (pathname === "/projects" || pathname === "/projects/" || pathname === "/projects/new") return "clear";
  const m = /^\/projects\/([^/]+)(?:\/|$)/.exec(pathname);
  if (m && isUuid(m[1])) return { set: m[1] };
  return null;
}

// 用語集で出す帯のプロジェクト。cookie の id の形を確かめ、RLS の効くクライアントで読む（他人の・消えたものは見えないので null）
export async function lastProjectFor(db: SupabaseClient<Database>, cookieValue: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!cookieValue || !isUuid(cookieValue)) return null;
  const { data, error } = await db.from("projects").select("id, name").eq("id", cookieValue).maybeSingle();
  if (error) return null;
  return data;
}
