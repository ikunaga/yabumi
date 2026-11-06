import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { addDays } from "@/lib/time";
import { loadGoals } from "./load";
import type { GoalInput, KpiInput } from "./schema";
import { GoalError, reviseGoal, setGoalKpis, startGoal } from "./write";

// ロードマップの「目標と数字を手で決める・直す」（段階 ②）。利用者の権限のクライアントで、DB の関数だけで書く。
// - KGI の文が空: KPI だけ入れ替える
// - いまの目標と同じ数字（成果の種類・SNS も同じ）: 見直し（revise_goal。文・目標の値・期限と、まだ始まっていない中間の目標）
// - KGI まだ・前の KGI（投稿の本数）・数字の種類を変えた: 新しい目標を始める（start_goal。前の目標は結果を数えて「これまでの目標」に残る。
//   KGI まだの目標は同じ行に書き入れる）
type Db = SupabaseClient<Database>;

export type ManualGoalInput = {
  goal: GoalInput | null;
  // 中間の目標 {何か月目: 値}。画面から送られた区切りだけ（始まった区切りの欄は送られない。null は目標なし）
  milestones: Record<number, number | null>;
  kpis: KpiInput[];
};

export async function saveManualGoal(db: Db, projectId: string, input: ManualGoalInput): Promise<"kpis" | "revised" | "started"> {
  if (!input.goal) {
    await setGoalKpis(db, projectId, input.kpis);
    return "kpis";
  }
  const goal = input.goal;
  const { active, today } = await loadGoals(db, projectId);
  const g = active?.goal;
  if (active && g && g.metric !== "posts" && g.metric === goal.metric && g.action === goal.action && g.sns === goal.sns && g.endsOn) {
    const endsOn = addDays(g.startsOn, goal.weeks * 7 - 1);
    if (endsOn < today) throw new GoalError("期限が今日より前になります。週の数を増やしてください。");
    const patch: Record<number, number | null> = {};
    for (const m of active.milestones) if (m.startsOn > today && m.seq in input.milestones) patch[m.seq] = input.milestones[m.seq];
    await reviseGoal(db, g.id, { statement: goal.statement, target: goal.target, endsOn: endsOn === g.endsOn ? undefined : endsOn, milestones: patch });
    await setGoalKpis(db, projectId, input.kpis);
    return "revised";
  }
  const values = Array.from({ length: 13 }, (_, i) => input.milestones[i + 1] ?? null);
  await startGoal(db, projectId, { goal, milestones: values, kpis: input.kpis }, "manual");
  return "started";
}
