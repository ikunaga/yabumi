"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { KPIS } from "@/lib/metrics/kpis";
import { addItemForm, type RoadmapFormState } from "@/lib/roadmap/actions";
import { AUTO_KPIS, MAX_ITEM_TITLE } from "@/lib/roadmap/schema";

const input =
  "rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]";

// やることを 1 つ足す。週は選べる週（今週から 8 週先まで）から
export function AddItemForm({ projectId, weeks }: { projectId: string; weeks: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<RoadmapFormState, FormData>(addItemForm.bind(null, projectId), {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="flex flex-col gap-2 px-5 py-4 text-sm max-sm:px-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted">
          やること
          <input name="title" required maxLength={MAX_ITEM_TITLE} placeholder="例: 投稿の柱「詰まった・直した」で 1 本書く" className={`${input} w-full`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          週
          <select name="week_start" defaultValue={weeks[0]?.value} className={input}>
            {weeks.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          数字と結びつける（任意）
          <span className="flex items-center gap-1">
            <select name="kpi" defaultValue="" className={input}>
              <option value="">なし</option>
              {AUTO_KPIS.map((k) => (
                <option key={k} value={k}>
                  {KPIS[k].label}
                </option>
              ))}
            </select>
            <input name="target" inputMode="decimal" placeholder="目標" aria-label="目標の値" className={`${input} w-[72px]`} />
          </span>
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          追加する
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
