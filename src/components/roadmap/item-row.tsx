"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help";
import Link from "next/link";
import { deleteItem, setItemPlannedOn, setItemStatus } from "@/lib/roadmap/actions";
import type { RoadmapItem } from "@/lib/roadmap/load";
import { formatValue, kpiLabel } from "@/lib/roadmap/schema";
import { todoAction } from "@/lib/roadmap/todo-kind";
import { addDays, dayOfMonth, monthOf, weekdayLabel } from "@/lib/time";

// やること 1 つ。チェックで済みにする。数字と結びついていれば、数字から進み具合を出す（済みにするのは利用者）。
// 予定日（任意。その週の中の日）を選べ、カレンダーのその日に出る。「この内容で投稿をつくる」で、作った投稿をこのやることに結びつける。
// 投稿しないやることは、種類に合う画面へのリンク（振り返る・プロフィールを開くなど。4.42）。ほかの画面の「ロードマップで見る」は、この行（#item-<id>）に来る
export function RoadmapItemRow({
  projectId,
  item,
  aiEnabled,
  progress,
  notCounted,
}: {
  projectId: string;
  item: RoadmapItem;
  aiEnabled: boolean;
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
  const action = todoAction(`/projects/${projectId}`, item, { aiEnabled });

  return (
    <li id={`item-${item.id}`} className="flex scroll-mt-24 flex-col gap-1 border-b border-line px-6 py-3 last:border-b-0 target:bg-primary-soft/50 max-sm:px-4">
      {/* スマホはボタン（やらない・削除する）をタイトルの下の行に回す（横に並べるとタイトルが細くなるため） */}
      <div className="flex items-start gap-3 max-sm:flex-wrap">
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
            {item.status === "todo" && action.kind !== "other" && (
              <Link href={action.href} className="font-semibold text-primary hover:underline">
                {action.kind === "post" ? "この内容で投稿をつくる" : action.label}
              </Link>
            )}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1 max-sm:-mt-1 max-sm:w-full max-sm:pl-5">
          {item.status === "todo" && (
            <span className="inline-flex items-center">
              <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => run(() => setItemStatus(projectId, item.id, "skipped"))}>
                やらない
              </Button>
              {/* 「削除する」との違いは押す前にはわからないので、説明を添える（2026-11-03 オーナーの決定） */}
              <HelpTip label="「やらない」の説明">あとで戻せます。AI との相談にも、やらないと決めたことが伝わります。要らないものは削除してください。</HelpTip>
            </span>
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
            // 「×」だと閉じるのか消すのかがわからないので、文字にする（2026-11-03 オーナーの決定）。押すと「削除する」「やめる」で確かめる
            <Button type="button" variant="text" size="sm" onClick={() => setConfirmDelete(true)} aria-label={`「${item.title}」を削除する`}>
              削除する
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
