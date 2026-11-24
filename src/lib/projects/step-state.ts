import "server-only";
import { planProgressByProject } from "@/lib/plan/queries";
import { weekStartOf } from "@/lib/roadmap/schema";
import { isManualSns, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { activeSnsByProject } from "@/lib/sns/queries";
import { createClient } from "@/lib/supabase/server";
import { toYmd } from "@/lib/time";
import type { StepState, WeekTodoCounts } from "./next-step";

export type ProjectStepState = StepState & { connectedSns: SnsKey[]; thisWeek: WeekTodoCounts };

// 「いまのタスク」（next-step.ts）の判定に使う値を、プロジェクトごとにまとめて取る。一覧と概要はどちらもここから取る
// （2026-10-22 の不具合: 一覧が投稿済みかとロードマップの有無を渡しておらず、いつも「最初の投稿をつくる」になった）。
// 問い合わせはプロジェクトの数にかかわらず 4 つ（設計・つないだ SNS・手動で投稿の SNS の URL・投稿とロードマップ）。RLS で本人のものだけ。
// 手動で投稿の SNS（note・Substack）は、つながなくても使うので、URL を登録していれば「つないだ」に数える（2026-11-24 オーナーの指示の横展開。PM の判断）
export async function loadStepStates(projects: { id: string; target_audience: string }[], now: Date = new Date()): Promise<Record<string, ProjectStepState>> {
  if (projects.length === 0) return {};
  const only = projects.length === 1 ? projects[0].id : undefined;
  const supabase = await createClient();
  const manualQuery = supabase.from("project_manual_channels").select("project_id, sns").not("profile_url", "is", null);
  const [plans, sns, manual, { data: flags, error }] = await Promise.all([
    planProgressByProject(projects),
    activeSnsByProject(only),
    only ? manualQuery.eq("project_id", only) : manualQuery,
    // p_project_id が null なら見えるすべてのプロジェクト（生成した型は null を受けないため）
    supabase.rpc("project_step_flags", { p_project_id: only ?? (null as unknown as string), p_week_start: weekStartOf(toYmd(now)) }),
  ]);
  if (error) throw error;
  if (manual.error) throw manual.error;
  const manualBy = new Map<string, SnsKey[]>();
  for (const m of manual.data ?? []) {
    const k = m.sns as SnsKey;
    if (SNS_KEYS.includes(k) && isManualSns(k)) manualBy.set(m.project_id, [...(manualBy.get(m.project_id) ?? []), k]);
  }
  const byProject = new Map((flags ?? []).map((f) => [f.project_id, f]));
  return Object.fromEntries(
    projects.map((p) => {
      const f = byProject.get(p.id);
      const joined = [...(sns[p.id] ?? []), ...(manualBy.get(p.id) ?? [])];
      const connectedSns = SNS_KEYS.filter((k) => joined.includes(k));
      return [
        p.id,
        {
          planDone: plans[p.id] ?? false,
          connectedSnsCount: connectedSns.length,
          connectedSns,
          hasPublished: f?.has_published ?? false,
          hasRoadmap: f?.has_roadmap ?? false,
          thisWeek: { open: Number(f?.this_week_todo ?? 0), finished: Number(f?.this_week_done ?? 0), carried: Number(f?.this_week_carried ?? 0) },
        },
      ];
    }),
  );
}
