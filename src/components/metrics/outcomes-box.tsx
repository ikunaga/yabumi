"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { saveOutcome, type OutcomeState } from "@/lib/metrics/actions";
import { OUTCOME_ACTIONS, type DesiredAction, type OutcomeAction } from "@/lib/projects/product-types";

// 記録するときの短い名前
const OUTCOME_LABEL: Record<OutcomeAction, string> = { purchase: "買ってもらった", signup: "申し込み・会員登録", booking: "予約", inquiry: "問い合わせ", visit: "来店" };

// 成果を手で記録する（決定 D34。project_outcomes_daily）。日・種類・数を選んで入れる。目標の成果を先に並べる
export function OutcomesBox({
  projectId,
  rows,
  total,
  goal,
  today,
}: {
  projectId: string;
  // 記録した日ごとの合計（新しい順に 5 日まで出す）
  rows: { day: string; value: number }[];
  // 選んだ期間の合計
  total: number;
  goal: DesiredAction | null;
  today: string;
}) {
  const [state, action, pending] = useActionState<OutcomeState, FormData>(saveOutcome.bind(null, projectId), {});
  const order = [...OUTCOME_ACTIONS].sort((a, b) => (a === goal ? -1 : b === goal ? 1 : 0));
  const recent = [...rows].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 5);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        合計 <b className="num text-[20px]">{total.toLocaleString("ja-JP")}</b> 件
      </p>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          日
          <input type="date" name="day" defaultValue={today} max={today} required className="h-10 rounded-md border border-input bg-surface px-2 text-sm text-fg" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          成果
          <select name="action" defaultValue={order[0]} className="h-10 rounded-md border border-input bg-surface px-2 text-sm text-fg">
            {order.map((a) => (
              <option key={a} value={a}>
                {OUTCOME_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          数
          <input type="number" name="count" min={0} max={100000} required inputMode="numeric" className="num h-10 w-24 rounded-md border border-input bg-surface px-2 text-sm text-fg" />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "記録しています…" : "記録する"}
        </Button>
      </form>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.ok && <p className="text-sm text-success">記録しました。</p>}
      {recent.length > 0 && (
        <ul className="num text-xs text-muted">
          {recent.map((r) => (
            <li key={r.day}>
              {Number(r.day.slice(5, 7))}/{Number(r.day.slice(8))} {r.value.toLocaleString("ja-JP")} 件
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
