import type { SupabaseClient } from "@supabase/supabase-js";
import { hasTargets, withFirstMonthCycle, type WeeklyTargets } from "@/lib/coach/pace";
import type { Database } from "@/lib/supabase/database.types";
import { isSnsKey, SNS_KEYS } from "@/lib/sns";
import { toYmd } from "@/lib/time";
import { MAX_WEEKLY_PER_SNS, sectionSchemas, type PlanData, type SectionKey, type SectionValue } from "./schema";

// アカウント設計の 1 セクションを保存する（画面・AI と考える・AI と相談の共通の入口。利用者の権限のクライアントで、RLS で本人のものだけ）。
// 最初の 1 か月は、数え始めの日を決め（withFirstMonthCycle）、SNS ごとの週の回数をロードマップの「毎週の目標」にも写す（伴走 4.27）
type Db = SupabaseClient<Database>;

export async function saveSectionValue(
  user: Db,
  projectId: string,
  key: SectionKey,
  value: SectionValue<SectionKey>,
  source: "ai" | "manual",
  opts: { restart?: boolean; now?: Date } = {},
): Promise<{ ok: true } | { ok: false }> {
  let v = value;
  if (key === "first_month") {
    const prev = await loadFirstMonth(user, projectId);
    v = withFirstMonthCycle(value as PlanData["first_month"], prev, toYmd(opts.now ?? new Date()), opts.restart);
  }
  const { error } = await user.rpc("save_account_plan_section", { p_project_id: projectId, p_section: key, p_value: v as never, p_source: source });
  if (error) return { ok: false };
  if (key === "first_month") await syncRoadmapFromWeekly(user, projectId, (v as PlanData["first_month"]).weekly);
  return { ok: true };
}

export async function loadFirstMonth(user: Db, projectId: string): Promise<PlanData["first_month"] | null> {
  const { data } = await user.from("account_plans").select("data").eq("project_id", projectId).maybeSingle();
  const raw = (data?.data as Record<string, unknown> | null)?.first_month;
  const parsed = sectionSchemas.first_month.safeParse(raw ?? {});
  return parsed.success ? parsed.data : null;
}

type Target = { kpi: string; per_week: number; sns?: string | null };

// 最初の 1 か月の SNS ごとの週の回数 → ロードマップの毎週の目標（SNS ごとの投稿した回数の行を置き換え、ほかの数字とすべての SNS の行は残す）。
// ロードマップがまだなければ何もしない（ロードマップを作るときに、AI が最初の 1 か月を基にする）
export async function syncRoadmapFromWeekly(user: Db, projectId: string, weekly: WeeklyTargets): Promise<void> {
  if (!hasTargets(weekly)) return;
  const { data: row } = await user.from("roadmaps").select("kpi_targets").eq("project_id", projectId).maybeSingle();
  if (!row) return;
  const current = (Array.isArray(row.kpi_targets) ? row.kpi_targets : []) as Target[];
  const fromWeekly: Target[] = SNS_KEYS.filter((s) => (weekly[s] ?? 0) > 0).map((s) => ({ kpi: "posts", per_week: weekly[s]!, sns: s }));
  const others = current.filter((t) => !(t.kpi === "posts" && t.sns));
  const next = [...fromWeekly, ...others].slice(0, 6);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  await user.from("roadmaps").update({ kpi_targets: next as never }).eq("project_id", projectId);
}

// ロードマップの毎週の目標に SNS ごとの投稿した回数があれば → 最初の 1 か月の週の回数（伴走が見張る数字）。なければ何もしない
export async function syncWeeklyFromRoadmap(user: Db, projectId: string, kpiTargets: Target[], source: "ai" | "manual", now = new Date()): Promise<void> {
  const weekly: WeeklyTargets = {};
  for (const t of kpiTargets) {
    if (t.kpi !== "posts" || !isSnsKey(t.sns)) continue;
    const n = Math.min(MAX_WEEKLY_PER_SNS, Math.round(t.per_week));
    if (n >= 1) weekly[t.sns] = n;
  }
  if (!hasTargets(weekly)) return;
  const prev = await loadFirstMonth(user, projectId);
  if (prev && sameWeekly(prev.weekly, weekly)) return;
  const base = prev ?? sectionSchemas.first_month.parse({});
  const v = withFirstMonthCycle({ ...base, weekly }, prev, toYmd(now));
  await user.rpc("save_account_plan_section", { p_project_id: projectId, p_section: "first_month", p_value: v as never, p_source: source });
}

function sameWeekly(a: WeeklyTargets, b: WeeklyTargets): boolean {
  return SNS_KEYS.every((s) => (a[s] ?? 0) === (b[s] ?? 0));
}
