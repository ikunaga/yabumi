"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help";
import Link from "next/link";
import { setItemPlannedOn, setItemStatus } from "@/lib/roadmap/actions";
import type { RoadmapItem } from "@/lib/roadmap/load";
import { effectiveStatus, formatValue, kpiLabel } from "@/lib/roadmap/schema";
import { todoAction } from "@/lib/roadmap/todo-kind";
import { addDays, dayOfMonth, monthOf, weekdayLabel } from "@/lib/time";

// やること 1 つ。チェックで済みにする。数字と結びついていれば、数字から進み具合を出す（済みにするのは利用者）。
// 予定日（任意。その週の中の日）を選べ、カレンダーのその日に出る。「この内容で投稿をつくる」で、作った投稿をこのやることに結びつける。
// 投稿しないやることは、種類に合う画面へのリンク（振り返る・プロフィールの案を見るなど。4.42）。ほかの画面の「ロードマップで見る」は、この行（#item-<id>）に来る
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
  const run = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
    });
  // 数字が目標に届いた（まだのやることでも「達成」。済みのチェックは手で付けられるまま）
  const state = effectiveStatus(item, progress);
  const action = todoAction(`/projects/${projectId}`, item, { aiEnabled });

  return (
    <li id={`item-${item.id}`} className="flex scroll-mt-24 flex-col gap-1 border-b border-line px-6 py-3 last:border-b-0 target:bg-primary-soft/50 max-sm:px-4">
      {/* スマホはボタン（やらない・削除する）をタイトルの下の行に回す（横に並べるとタイトルが細くなるため） */}
      <div className="flex items-start gap-3 max-sm:flex-wrap">
        {/* 自動で達成した（数字が目標に届いた・ここから作った投稿を送った）ものは、チェック済みで押せない四角にする。
            前は四角が空のまま横に「✓ 達成」が並び、押すべきか迷った（2026-11-12 PMO のローカルでの確かめ）。自動の達成は数字で決まるので手では取り消せない
            （数字が減ればまだに戻る。もうやらないなら「やらない」）。手で済みにしたものは、押せる四角と取り消し線のまま（押すと戻る） */}
        <input
          type="checkbox"
          aria-label={state === "achieved" ? `「${item.title}」は自動で達成しました` : `「${item.title}」を済みにする`}
          checked={item.status === "done" || state === "achieved"}
          disabled={pending || state === "achieved"}
          onChange={(e) => run(() => setItemStatus(projectId, item.id, e.target.checked ? "done" : "todo"))}
          className="mt-1 size-4 shrink-0 accent-[var(--primary)] disabled:opacity-50"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`text-[14px] ${state === "done" ? "text-muted line-through" : state === "skipped" || state === "achieved" ? "text-muted" : "font-bold"}`}>
            {item.title}
            {item.status === "skipped" && <span className="ml-2 text-xs font-normal">（やらない）</span>}
            {state === "achieved" && <span className="ml-2 text-xs font-bold whitespace-nowrap text-success">✓ 達成（自動）</span>}
          </span>
          {item.detail && <span className="text-xs leading-6 text-muted">{item.detail}</span>}
          {item.kpi && item.target !== null && (
            <span className="text-xs text-muted">
              {kpiLabel(item.kpi, item.sns)}: {progress ? `${formatValue(item.kpi, progress.actual)} / ${formatValue(item.kpi, progress.target)}` : `目標 ${formatValue(item.kpi, item.target)}（${notCounted}）`}
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
            {state === "todo" && action.kind !== "other" && (
              <Link href={action.href} className="font-semibold text-primary hover:underline">
                {action.kind === "post" ? "この内容で投稿をつくる" : action.label}
              </Link>
            )}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1 max-sm:-mt-1 max-sm:w-full max-sm:pl-5">
          {state === "todo" && (
            <span className="inline-flex items-center">
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => run(() => setItemStatus(projectId, item.id, "skipped"))}>
                やらない
              </Button>
              {/* 削除はなくし、やらないだけにする（2026-11-06 オーナーの決定）。押したあとに起きることを添える */}
              <HelpTip label="「やらない」の説明">あとで「戻す」で戻せます。AI との相談にも、やらないと決めたことが伝わります。</HelpTip>
            </span>
          )}
          {item.status === "skipped" && (
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => run(() => setItemStatus(projectId, item.id, "todo"))}>
              戻す
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
