import "server-only";
import { planProgressByProject } from "@/lib/plan/queries";
import { weekStartOf } from "@/lib/roadmap/schema";
import type { SnsKey } from "@/lib/sns";
import { activeSnsByProject } from "@/lib/sns/queries";
import { createClient } from "@/lib/supabase/server";
import { toYmd } from "@/lib/time";
import type { StepState } from "./next-step";

export type ProjectStepState = StepState & { connectedSns: SnsKey[]; thisWeekTodo: number };

// 「いまやること」（next-step.ts）の判定に使う値を、プロジェクトごとにまとめて取る。一覧と概要はどちらもここから取る
// （2026-10-22 の不具合: 一覧が投稿済みかとロードマップの有無を渡しておらず、いつも「最初の投稿をつくる」になった）。
// 問い合わせはプロジェクトの数にかかわらず 3 つ（設計・つないだ SNS・投稿とロードマップ）。RLS で本人のものだけ
export async function loadStepStates(projects: { id: string; target_audience: string }[], now: Date = new Date()): Promise<Record<string, ProjectStepState>> {
  if (projects.length === 0) return {};
  const only = projects.length === 1 ? projects[0].id : undefined;
  const supabase = await createClient();
  const [plans, sns, { data: flags, error }] = await Promise.all([
    planProgressByProject(projects),
    activeSnsByProject(only),
    // p_project_id が null なら見えるすべてのプロジェクト（生成した型は null を受けないため）
    supabase.rpc("project_step_flags", { p_project_id: only ?? (null as unknown as string), p_week_start: weekStartOf(toYmd(now)) }),
  ]);
  if (error) throw error;
  const byProject = new Map((flags ?? []).map((f) => [f.project_id, f]));
  return Object.fromEntries(
    projects.map((p) => {
      const f = byProject.get(p.id);
      const connectedSns = sns[p.id] ?? [];
      return [
        p.id,
        {
          planDone: plans[p.id] ?? false,
          connectedSnsCount: connectedSns.length,
          connectedSns,
          hasPublished: f?.has_published ?? false,
          hasRoadmap: f?.has_roadmap ?? false,
          thisWeekTodo: Number(f?.this_week_todo ?? 0),
        },
      ];
    }),
  );
}
