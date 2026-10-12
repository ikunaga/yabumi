"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { deleteItem, setItemPlannedOn, setItemStatus } from "@/lib/roadmap/actions";
import type { RoadmapItem } from "@/lib/roadmap/load";
import { formatValue, kpiLabel } from "@/lib/roadmap/schema";
import { addDays, dayOfMonth, monthOf, weekdayLabel } from "@/lib/time";

// やること 1 つ。チェックで済みにする。数字と結びついていれば、数字から進み具合を出す（済みにするのは利用者）。
// 予定日（任意。その週の中の日）を選べ、カレンダーのその日に出る。「この内容で投稿をつくる」で、作った投稿をこのやることに結びつける
export function RoadmapItemRow({
  projectId,
  item,
  progress,
  notCounted,
}: {
  projectId: string;
  item: RoadmapItem;
  progress: { actual: number; target: number } | null;
  notCounted: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
    });
  const reached = progress !== null && progress.actual >= progress.target;

  return (
    <li className="flex flex-col gap-1 border-b border-line px-5 py-3 last:border-b-0 max-sm:px-4">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`「${item.title}」を済みにする`}
          checked={item.status === "done"}
          disabled={pending}
          onChange={(e) => run(() => setItemStatus(projectId, item.id, e.target.checked ? "done" : "todo"))}
          className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`text-[14px] ${item.status === "done" ? "text-muted line-through" : item.status === "skipped" ? "text-muted" : "font-bold"}`}>
            {item.title}
            {item.status === "skipped" && <span className="ml-2 text-xs font-normal">（やらない）</span>}
          </span>
          {item.detail && <span className="text-xs leading-6 text-muted">{item.detail}</span>}
          {item.kpi && item.target !== null && (
            <span className="text-xs text-muted">
              {kpiLabel(item.kpi, item.sns)}: {progress ? `${formatValue(item.kpi, progress.actual)} / ${formatValue(item.kpi, progress.target)}` : `目標 ${formatValue(item.kpi, item.target)}（${notCounted}）`}
              {reached && item.status === "todo" && <span className="ml-2 font-bold text-success">目標に届きました。済みにしますか？</span>}
            </span>
          )}
          {item.posts && item.posts.linkedPublished + item.posts.linkedScheduled > 0 && (
            <span className="text-xs text-muted">
              ここから作った投稿: {[item.posts.linkedPublished ? `送信済み ${item.posts.linkedPublished}` : "", item.posts.linkedScheduled ? `予約 ${item.posts.linkedScheduled}` : ""].filter(Boolean).join("・")}
            </span>
          )}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs">
            <label className="inline-flex items-center gap-1.5 text-muted">
              <span className="whitespace-nowrap">予定日</span>
              <select
                value={item.plannedOn ?? ""}
                disabled={pending}
                onChange={(e) => run(() => setItemPlannedOn(projectId, item.id, e.target.value || null))}
                className="rounded border border-input bg-surface px-1.5 py-0.5 text-xs text-fg max-sm:text-[16px]"
              >
                <option value="">決めない</option>
                {Array.from({ length: 7 }, (_, i) => addDays(item.weekStart, i)).map((d) => (
                  <option key={d} value={d}>
                    {monthOf(d)}/{dayOfMonth(d)}（{weekdayLabel(d)}）
                  </option>
                ))}
              </select>
            </label>
            {item.status === "todo" && (
              <Link href={`/projects/${projectId}/compose?item=${item.id}`} className="font-semibold text-primary hover:underline">
                この内容で投稿をつくる
              </Link>
            )}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {item.status === "todo" && (
            <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => run(() => setItemStatus(projectId, item.id, "skipped"))}>
              やらない
            </Button>
          )}
          {item.status === "skipped" && (
            <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => run(() => setItemStatus(projectId, item.id, "todo"))}>
              戻す
            </Button>
          )}
          {confirmDelete ? (
            <>
              <Button type="button" variant="danger" size="sm" disabled={pending} onClick={() => run(() => deleteItem(projectId, item.id))}>
                削除する
              </Button>
              <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => setConfirmDelete(false)}>
                やめる
              </Button>
            </>
          ) : (
            <Button type="button" variant="text" size="sm" onClick={() => setConfirmDelete(true)} aria-label={`「${item.title}」を削除する`}>
              ×
            </Button>
          )}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
