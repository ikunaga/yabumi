"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { saveManualMetric, type ManualMetricState } from "@/lib/metrics/actions";

// note・Substack の数字を手で入れる欄（1 つの投稿につき 1 行）
export function ManualMetricForm({
  projectId,
  targetId,
  views,
  reactions,
  viewsLabel,
  reactionsLabel,
}: {
  projectId: string;
  targetId: string;
  views: number | null;
  reactions: number | null;
  viewsLabel: string;
  reactionsLabel: string;
}) {
  const [state, action, pending] = useActionState<ManualMetricState, FormData>(saveManualMetric.bind(null, projectId, targetId), {});
  const input =
    "w-[110px] rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]";
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {viewsLabel}
        <input name="views" inputMode="numeric" defaultValue={views ?? ""} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {reactionsLabel}
        <input name="reactions" inputMode="numeric" defaultValue={reactions ?? ""} className={input} />
      </label>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        記録
      </Button>
      {state.ok && <span className="text-xs font-semibold text-success">記録しました</span>}
      {state.error && <span className="text-xs font-semibold text-danger">{state.error}</span>}
    </form>
  );
}
