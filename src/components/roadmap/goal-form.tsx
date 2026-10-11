"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { KPI_KEYS, KPIS, type KpiKey } from "@/lib/metrics/kpis";
import { saveGoalForm, type RoadmapFormState } from "@/lib/roadmap/actions";
import { MAX_KPI_TARGETS, type Kgi, type KpiTarget } from "@/lib/roadmap/schema";

const input =
  "rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]";

function KpiOptions() {
  return (
    <>
      {KPI_KEYS.map((k) => (
        <option key={k} value={k}>
          {KPIS[k].label}
          {KPIS[k].availability === "later" ? "（まだ数えていない）" : ""}
        </option>
      ))}
    </>
  );
}

// 目標（KGI）と、追いかける数字（KPI）の週の目標を手で決める・直す
export function GoalForm({ projectId, kgi, kpiTargets, suggested }: { projectId: string; kgi: Kgi | null; kpiTargets: KpiTarget[]; suggested: KpiKey[] }) {
  const [state, action, pending] = useActionState<RoadmapFormState, FormData>(saveGoalForm.bind(null, projectId), {});
  const rows: (KpiTarget | null)[] = [...kpiTargets, ...Array(MAX_KPI_TARGETS).fill(null)].slice(0, MAX_KPI_TARGETS);
  return (
    <form action={action} className="flex flex-col gap-4 text-sm">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-bold">最終の目標（KGI）</legend>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">いつまでに・何を・どれだけ（例: 3 か月で 100 ダウンロード）</span>
          <input name="statement" defaultValue={kgi?.statement ?? ""} maxLength={120} className={`${input} w-full`} />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            数字の種類
            <select name="kgi_kpi" defaultValue={kgi?.kpi ?? suggested[0] ?? "posts"} className={input}>
              <KpiOptions />
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            目標の値
            <input name="kgi_target" inputMode="decimal" defaultValue={kgi?.target ?? ""} className={`${input} w-[110px]`} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            期限
            <input name="kgi_deadline" type="date" defaultValue={kgi?.deadline ?? ""} className={input} />
          </label>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-bold">追いかける数字（KPI）と 1 週の目標</legend>
        {rows.map((t, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select name="kpi" defaultValue={t?.kpi ?? ""} aria-label={`${i + 1} つ目の数字`} className={input}>
              <option value="">（使わない）</option>
              <KpiOptions />
            </select>
            <span className="text-xs text-muted">1 週に</span>
            <input name="per_week" inputMode="decimal" defaultValue={t?.per_week ?? ""} aria-label={`${i + 1} つ目の 1 週の目標`} className={`${input} w-[90px]`} />
          </div>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          保存する
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
