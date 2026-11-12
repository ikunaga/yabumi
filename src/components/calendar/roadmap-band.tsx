"use client";

import { useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { Button, ButtonLink } from "@/components/ui/button";
import type { CalendarTodo, WeekBand, WeekGoal } from "@/lib/calendar/roadmap-view";
import type { PaceStatus } from "@/lib/coach/pace";
import { setItemPlannedOn, setItemStatus } from "@/lib/roadmap/actions";
import { addDays, dayOfMonth, monthOf, weekdayLabel } from "@/lib/time";

// カレンダーのロードマップのやることと週の目標（F06・F10。docs/architecture.md の 4.23）。
// やることは投稿の予約と見分けられるように、薄い地に「□」で出す（注意の印の色は使わない。予約と要確認の印に使うため）

const GOAL_STATUS: Record<PaceStatus, { mark: string; className: string; label: string }> = {
  done: { mark: "✓", className: "font-bold text-success", label: "届きました" },
  on_track: { mark: "", className: "text-primary", label: "予約で届きます" },
  behind: { mark: "●", className: "font-bold text-signal", label: "遅れそう" },
  not_yet: { mark: "", className: "text-muted", label: "これから" },
  missed: { mark: "", className: "text-muted", label: "届かなかった" },
};

const noopSubscribe = () => () => {};

const TODO_MARK: Record<CalendarTodo["status"], string> = { todo: "□", done: "✓", achieved: "✓", skipped: "–" };

// 週の目標（伴走の週の回数）: 「X 1 / 2・Instagram 0 / 1」
function Goals({ goals, isThisWeek }: { goals: WeekGoal[]; isThisWeek: boolean }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
      <span className="font-bold text-muted">{isThisWeek ? "今週の目標" : "週の目標"}</span>
      {goals.map((g) => (
        <span key={g.sns} className="whitespace-nowrap">
          {g.sns} <b>{g.published}</b> / {g.target}
          {g.scheduled > 0 && <span className="text-muted">（予約 {g.scheduled}）</span>}
          <span className={`ml-1 ${GOAL_STATUS[g.status].className}`} title={GOAL_STATUS[g.status].label}>
            {GOAL_STATUS[g.status].mark || ""}
            <span className={GOAL_STATUS[g.status].mark ? "sr-only" : ""}>{GOAL_STATUS[g.status].mark ? GOAL_STATUS[g.status].label : `・${GOAL_STATUS[g.status].label}`}</span>
          </span>
        </span>
      ))}
    </p>
  );
}

// 週の帯。目標もやることもない週は出さない
export function WeekBandView({ band, base, today, compact = false }: { band: WeekBand | undefined; base: string; today: string; compact?: boolean }) {
  if (!band || (band.todos.length === 0 && band.goals.length === 0)) return null;
  const isThisWeek = today >= band.weekStart && today <= addDays(band.weekStart, 6);
  return (
    <div className={`flex flex-col gap-1 ${compact ? "px-2 py-1.5" : "px-3 py-2"} ${isThisWeek ? "bg-primary-soft/40" : "bg-surface2"}`}>
      {band.goals.length > 0 && <Goals goals={band.goals} isThisWeek={isThisWeek} />}
      {band.todos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-muted">やること</span>
          {band.todos.map((t) => (
            <TodoButton key={t.id} todo={t} base={base} />
          ))}
        </div>
      )}
    </div>
  );
}

// やること 1 つ。押すと中身と「この内容で投稿をつくる」を出す。
// 題名は、PC の月・週のマス（day）だけ 1 行で切り、週の帯（band）は 2 行、スマホの日ごとの一覧（list）は 3 行まで折り返す
export function TodoButton({ todo, base, variant = "band" }: { todo: CalendarTodo; base: string; variant?: "band" | "day" | "list" }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // 中身は body 直下に出す（月のマスの overflow で切れないように）。サーバーで描くときは出さない
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const titleId = useId();
  const finished = todo.status !== "todo";

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
        title={todo.title}
        className={`inline-flex max-w-full min-w-0 gap-1 rounded-sm border text-left text-xs leading-5 ${
          variant === "day" ? "relative z-10 w-full items-center px-1" : variant === "list" ? "w-full items-start px-2 py-1" : "items-start px-1.5 py-px"
        } ${finished ? "border-line bg-surface2 text-muted" : "border-primary/30 bg-primary-soft text-primary hover:border-primary"}`}
      >
        <span aria-hidden className={todo.status === "done" || todo.status === "achieved" ? "font-bold text-success" : ""}>
          {TODO_MARK[todo.status]}
        </span>
        <span className="sr-only">{todo.status === "done" ? "済み" : todo.status === "achieved" ? "数字で達成" : todo.status === "skipped" ? "やらない" : "やること"}:</span>
        <span className={`min-w-0 ${variant === "day" ? "truncate" : variant === "list" ? "line-clamp-3 break-words" : "line-clamp-2 break-words"} ${todo.status === "done" ? "line-through" : ""}`}>
          {todo.title}
        </span>
        {variant === "band" && todo.progress && <span className="shrink-0 text-muted">{todo.progress.replace(/（予約 \d+）/, "")}</span>}
        {todo.overdue && (
          <span className="shrink-0 font-bold text-signal" title="予定日を過ぎています">
            !<span className="sr-only">予定日を過ぎています</span>
          </span>
        )}
      </button>
      {mounted &&
        createPortal(
          <dialog
            ref={dialogRef}
            aria-labelledby={titleId}
            onClick={(e) => {
              if (e.target === e.currentTarget) dialogRef.current?.close();
            }}
            className="m-auto w-[min(30rem,calc(100%-2rem))] rounded-lg border border-border bg-surface p-5 text-fg shadow-pop backdrop:bg-scrim max-sm:p-4"
          >
            <TodoDetail todo={todo} base={base} titleId={titleId} onClose={() => dialogRef.current?.close()} />
          </dialog>,
          document.body,
        )}
    </>
  );
}

function TodoDetail({ todo, base, titleId, onClose }: { todo: CalendarTodo; base: string; titleId: string; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const projectId = base.split("/")[2];
  const run = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
    });
  const days = Array.from({ length: 7 }, (_, i) => addDays(todo.weekStart, i));

  return (
    <div className="flex flex-col gap-3 text-[14px] leading-7">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted">
            ロードマップのやること（{monthOf(todo.weekStart)}/{dayOfMonth(todo.weekStart)} の週）
          </span>
          <h2 id={titleId} className={`text-base font-bold ${todo.status === "done" ? "text-muted line-through" : ""}`}>
            {todo.title}
          </h2>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-sm text-muted hover:text-fg" aria-label="閉じる">
          ✕
        </button>
      </div>
      {todo.detail && <p className="text-sm leading-6 text-muted">{todo.detail}</p>}
      {(todo.progress || todo.linked) && (
        <ul className="flex flex-col text-sm">
          {todo.progress && <li>進み具合: {todo.progress}</li>}
          {todo.linked && <li className="text-muted">{todo.linked}</li>}
        </ul>
      )}
      {todo.overdue && <p className="text-sm font-semibold text-signal">予定日を過ぎています。まだ投稿を予約・送信していません。</p>}

      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold">予定日</span>
        <select
          value={todo.plannedOn ?? ""}
          disabled={pending}
          onChange={(e) => run(() => setItemPlannedOn(projectId, todo.id, e.target.value || null))}
          className="rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm text-fg max-sm:text-[16px]"
        >
          <option value="">決めない（週のどこか）</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {monthOf(d)}/{dayOfMonth(d)}（{weekdayLabel(d)}）
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {/* 種類ごとの行き先（4.42）。ほかのやることは下の「ロードマップで見る」だけ */}
        {todo.action.kind !== "other" && (
          <ButtonLink href={todo.action.href} size="sm">
            {todo.action.kind === "post" ? "この内容で投稿をつくる" : todo.action.label}
          </ButtonLink>
        )}
        {/* 自動で達成したものは、押す「済みにする」を出さない（ロードマップの押せないチェックと同じ考え方。2026-11-12 PMO のローカルでの確かめ） */}
        {todo.status === "achieved" ? (
          <span className="text-sm font-bold text-success">✓ 達成（自動）</span>
        ) : todo.status === "done" ? (
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => run(() => setItemStatus(projectId, todo.id, "todo"))}>
            まだに戻す
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => run(() => setItemStatus(projectId, todo.id, "done"))}>
            済みにする
          </Button>
        )}
        <a href={`${base}/roadmap#item-${todo.id}`} className="ml-auto text-sm font-semibold text-primary hover:underline">
          ロードマップで見る
        </a>
      </div>
    </div>
  );
}
