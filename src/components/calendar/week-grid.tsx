import Link from "next/link";
import { displayStatus } from "@/components/posts/post-chip";
import type { CalendarTodo } from "@/lib/calendar/roadmap-view";
import type { PlannedAutoChip } from "@/lib/calendar/auto-chips";
import { postTitle, type PostRow } from "@/lib/posts/queries";
import { dayOfMonth, formatTime, monthOf, toYmd, weekdayLabel } from "@/lib/time";
import { TodoButton } from "./roadmap-band";
import { SnsLabel } from "./sns-label";

// いつも出す時刻の行（見本 C）。投稿がほかの時刻にあれば、その時刻の行を足す
const BASE_HOURS = [9, 12, 18, 21];

// PC の週の表示: 時刻 × 曜日のマス目に、SNS の色の札を置く（見本 C）。空いているマスを押すと、その日の投稿をつくる。
// planned は作る前の自動の回（点線の札）。hrefOf は投稿の札の行き先（自動の回の確かめ待ちは確かめ待ちの画面へ）
export function WeekGrid({
  days,
  today,
  posts,
  planned = [],
  hrefOf,
  todosByDay,
  base,
}: {
  days: string[];
  today: string;
  posts: PostRow[];
  planned?: PlannedAutoChip[];
  hrefOf?: (p: PostRow) => string;
  todosByDay: Map<string, CalendarTodo[]>;
  base: string;
}) {
  const cells = new Map<string, PostRow[]>();
  const plannedCells = new Map<string, PlannedAutoChip[]>();
  const hours = new Set(BASE_HOURS);
  for (const p of posts) {
    const hour = Number(formatTime(p.planned_at!).slice(0, 2));
    hours.add(hour);
    const key = `${toYmd(new Date(p.planned_at!))}-${hour}`;
    cells.set(key, [...(cells.get(key) ?? []), p]);
  }
  for (const c of planned) {
    const hour = Number(formatTime(c.dueAt).slice(0, 2));
    hours.add(hour);
    const key = `${toYmd(new Date(c.dueAt))}-${hour}`;
    plannedCells.set(key, [...(plannedCells.get(key) ?? []), c]);
  }
  const rows = [...hours].sort((a, b) => a - b);
  const hasTodos = days.some((d) => (todosByDay.get(d) ?? []).length > 0);
  const cols = "grid grid-cols-[64px_repeat(7,minmax(0,1fr))]";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className={`${cols} border-b border-line bg-surface2 text-[13px] text-faint`}>
        <div className="px-2 py-2 text-center">時刻</div>
        {days.map((d) => (
          <div key={d} className={`px-2 py-2 text-center ${d === today ? "font-bold text-fg" : ""}`}>
            <span className="num">{dayOfMonth(d)}</span> {weekdayLabel(d)}
            {d === today && <span className="ml-1 rounded-full bg-primary px-1.5 py-px text-[11px] text-on-primary">今日</span>}
          </div>
        ))}
      </div>
      {hasTodos && (
        <div className={`${cols} border-b border-line`}>
          <div className="border-r border-line bg-surface2 px-1 py-2 text-center text-[12px] text-faint">タスク</div>
          {days.map((d, i) => (
            <div key={d} className={`flex min-w-0 flex-col gap-1 p-1.5 ${i < 6 ? "border-r border-line" : ""}`}>
              {(todosByDay.get(d) ?? []).map((t) => (
                <TodoButton key={t.id} todo={t} base={base} variant="day" />
              ))}
            </div>
          ))}
        </div>
      )}
      {rows.map((h, r) => (
        <div key={h} className={`${cols} ${r < rows.length - 1 ? "border-b border-line" : ""}`}>
          <div className="num border-r border-line bg-surface2 px-1 py-3 text-center text-[13px] text-faint">{String(h).padStart(2, "0")}:00</div>
          {days.map((d, i) => {
            const list = cells.get(`${d}-${h}`) ?? [];
            const autoList = plannedCells.get(`${d}-${h}`) ?? [];
            return (
              <div
                key={d}
                className={`group relative flex min-h-[52px] min-w-0 flex-col gap-1 p-1.5 ${list.length + autoList.length > 0 ? "pb-5" : ""} ${i < 6 ? "border-r border-line" : ""} ${d === today ? "bg-surface2/60" : ""}`}
              >
                {/* 空いているところを押すと、その日の投稿をつくる（札は、この上に重ねる）。札のあるマスは下に余白を空け、「＋」を札の下に出す（4.39） */}
                <Link href={`${base}/compose?date=${d}`} className="absolute inset-0 flex items-end justify-end p-1 text-[11px] text-faint hover:bg-primary-soft/60 hover:no-underline">
                  <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">＋</span>
                  <span className="sr-only">
                    {monthOf(d)} 月 {dayOfMonth(d)} 日に投稿をつくる
                  </span>
                </Link>
                {list.map((p) => {
                  const time = formatTime(p.planned_at!);
                  return (
                    <SnsLabel
                      key={p.id}
                      href={hrefOf ? hrefOf(p) : `${base}/posts/${p.id}`}
                      sns={p.targets.map((t) => t.sns)}
                      status={displayStatus(p)}
                      time={time.endsWith(":00") ? undefined : time}
                      title={postTitle(p.body, 24)}
                      auto={Boolean(p.autoRunId)}
                    />
                  );
                })}
                {autoList.map((c) => {
                  const time = formatTime(c.dueAt);
                  return <SnsLabel key={c.id} href={c.href} sns={c.sns} status="draft" time={time.endsWith(":00") ? undefined : time} title={c.title} statusLabel={c.label} auto />;
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
