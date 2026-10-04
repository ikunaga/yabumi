import "server-only";
import { cache } from "react";
import { getProject } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";
import { isPlanDone, isSectionKey, normalizePlan, type PlanData, type SectionKey } from "./schema";

// どれも RLS により、ログイン中のユーザー自身のものしか返らない

export type PlanSources = Partial<Record<SectionKey, "ai" | "manual">>;
export type AccountPlan = { plan: PlanData; done: boolean; skipped: boolean; sources: PlanSources };

export const getAccountPlan = cache(async (projectId: string): Promise<AccountPlan | null> => {
  const project = await getProject(projectId);
  if (!project) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("account_plans").select("data, skipped_at, section_sources").eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  const plan = normalizePlan(data?.data, project.target_audience);
  const sources: PlanSources = {};
  for (const [k, v] of Object.entries((data?.section_sources as Record<string, unknown> | null) ?? {})) {
    if (isSectionKey(k) && (v === "ai" || v === "manual")) sources[k] = v;
  }
  return { plan, done: isPlanDone(plan), skipped: Boolean(data?.skipped_at), sources };
});

// プロジェクト一覧用: プロジェクトごとの設計の段階（済み、または飛ばした）
export async function planProgressByProject(projects: { id: string; target_audience: string }[]): Promise<Record<string, boolean>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("account_plans").select("project_id, data, skipped_at");
  if (error) throw error;
  const rows = new Map(data.map((r) => [r.project_id, r]));
  return Object.fromEntries(
    projects.map((p) => {
      const r = rows.get(p.id);
      return [p.id, Boolean(r?.skipped_at) || isPlanDone(normalizePlan(r?.data, p.target_audience))];
    }),
  );
}

// 投稿の作成画面に出す、投稿の柱と口調
export async function getPlanHints(projectId: string) {
  const p = await getAccountPlan(projectId);
  if (!p) return null;
  const { items, tone, avoid } = p.plan.pillars;
  return { pillars: items.filter((i) => i.name.trim()), tone, avoid };
}
