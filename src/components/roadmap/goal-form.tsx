"use client";

import { guardAction } from "@/lib/client-errors";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { saveGoalForm, type GoalFormState } from "@/lib/goals/actions";
import { DEFAULT_GOAL_WEEKS, MAX_KPIS_PER_GOAL, milestoneCount, MILESTONE_WEEKS, type Goal, type GoalKpi, type MetricRef, type Milestone } from "@/lib/goals/schema";
import { md, metricChoices, metricChoiceValue, milestoneName } from "@/lib/goals/view";
import { kgiExample } from "@/lib/roadmap/schema";

const input =
  "rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] disabled:opacity-60 max-sm:text-[16px]";

const WEEK_CHOICES = [4, 8, 12, 16, 24];

// 目標（KGI）・中間の目標・KPI を手で決める・直す。同じ数字のまま直すと見直し、数字の種類を変える・初めて決めると新しい目標として始める
export function GoalForm({
  projectId,
  goal,
  milestones,
  kpis,
  suggested,
  productType,
  today,
}: {
  projectId: string;
  // いまの目標（KGI まだなら metric が null）
  goal: Goal | null;
  milestones: Milestone[];
  kpis: GoalKpi[];
  // KGI がまだ・前の KGI が投稿の本数のときに選んでおく数字（見た人にしてほしいことから）
  suggested: MetricRef;
  productType: string | null;
  today: string;
}) {
  const [state, action, pending] = useActionState<GoalFormState, FormData>(guardAction(saveGoalForm.bind(null, projectId), (m) => ({ error: m })), {});
  // 前の KGI（投稿の本数）は成果の目標に変えてもらうので、ここでは「まだ」と同じに扱う
  const hasKgi = Boolean(goal?.metric && goal.metric !== "posts" && goal.endsOn);
  const currentValue = hasKgi && goal?.metric ? metricChoiceValue({ metric: goal.metric, action: goal.action }) : metricChoiceValue(suggested);
  const [metric, setMetric] = useState(currentValue);
  const spanWeeks = goal?.endsOn ? Math.round((Date.parse(goal.endsOn) - Date.parse(goal.startsOn)) / (7 * 86_400_000) + 1 / 7) : DEFAULT_GOAL_WEEKS;
  const [weeks, setWeeks] = useState(hasKgi ? spanWeeks : DEFAULT_GOAL_WEEKS);
  const choices = metricChoices(productType, [currentValue, ...kpis.map((k) => metricChoiceValue(k))]);
  const revising = hasKgi && metric === currentValue;
  // 見直しなら今の区切り（始まったものは直せない）、新しく始めるなら週の数からの区切り
  const rows = revising
    ? milestones.map((m) => ({ seq: m.seq, label: `${milestoneName(m.seq)}（${md(m.startsOn)}〜）`, value: m.target, locked: m.startsOn <= today }))
    : Array.from({ length: milestoneCount(weeks) }, (_, i) => ({ seq: i + 1, label: milestoneName(i + 1), value: null as number | null, locked: false }));
  const kpiRows: (GoalKpi | null)[] = [...kpis, ...Array(MAX_KPIS_PER_GOAL).fill(null)].slice(0, MAX_KPIS_PER_GOAL);

  return (
    <form action={action} className="flex flex-col gap-4 text-sm">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-bold">KGI（成果の目標）</legend>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">何を・どれだけ（例: {kgiExample(productType)}）</span>
          <input name="statement" defaultValue={hasKgi ? (goal?.statement ?? "") : ""} maxLength={120} className={`${input} w-full`} />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            数字の種類
            <select name="metric" value={metric} onChange={(e) => setMetric(e.target.value)} className={input}>
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            目標の値
            <input name="target" inputMode="decimal" defaultValue={hasKgi ? (goal?.target ?? "") : ""} className={`${input} w-[110px]`} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            期間
            <select name="weeks" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className={input}>
              {[...new Set([...WEEK_CHOICES, weeks])]
                .sort((a, b) => a - b)
                .map((w) => (
                  <option key={w} value={w}>
                    {w} 週{w === DEFAULT_GOAL_WEEKS ? "（約 3 か月）" : ""}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {hasKgi && !revising && <p className="text-xs text-muted">数字の種類を変えると、新しい目標として今週から数え始めます。いまの目標は「これまでの目標」に残ります。</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-bold">中間の目標（{MILESTONE_WEEKS} 週ごと）</legend>
        <div className="flex flex-wrap gap-3">
          {rows.map((r) => (
            <label key={r.seq} className="flex flex-col gap-1 text-xs text-muted">
              {r.label}
              <input name={`milestone-${r.seq}`} inputMode="decimal" defaultValue={r.value ?? ""} disabled={r.locked} placeholder="なし" className={`${input} w-[100px]`} />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-bold">KPI と 1 週の目標（{MAX_KPIS_PER_GOAL} つまで）</legend>
        {kpiRows.map((k, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select name="kpi" defaultValue={k ? metricChoiceValue(k) : ""} aria-label={`${i + 1} つ目の数字`} className={input}>
              <option value="">（使わない）</option>
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">1 週に</span>
            <input name="per_week" inputMode="decimal" defaultValue={k?.perWeek ?? ""} aria-label={`${i + 1} つ目の 1 週の目標`} className={`${input} w-[90px]`} />
          </div>
        ))}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {hasKgi && !revising ? "新しい目標を始める" : "保存する"}
        </Button>
        {state.ok && <span className="text-xs font-semibold text-success">保存しました</span>}
        {state.error && (
          <span role="alert" className="text-xs font-semibold text-danger">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
