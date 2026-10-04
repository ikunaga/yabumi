import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// どれも RLS により、ログイン中のユーザー自身のプロジェクトしか返らない

export async function listProjects() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, description, target_audience, app_store_url, play_store_url, updated_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// プロジェクト切替用の一覧（名前だけ）
export async function listProjectNames() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("id, name").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// レイアウトとページの両方から呼ぶので、1 リクエスト内では 1 回だけ読む
export const getProject = cache(async (id: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
});
