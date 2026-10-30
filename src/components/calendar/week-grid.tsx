import Link from "next/link";
import { displayStatus } from "@/components/posts/post-chip";
import type { CalendarTodo } from "@/lib/calendar/roadmap-view";
import { postTitle, type PostRow } from "@/lib/posts/queries";
import { dayOfMonth, formatTime, monthOf, toYmd, weekdayLabel } from "@/lib/time";
import { TodoButton } from "./roadmap-band";
import { SnsLabel } from "./sns-label";

// いつも出す時刻の行（見本 C）。投稿がほかの時刻にあれば、その時刻の行を足す
const BASE_HOURS = [9, 12, 18, 21];

// PC の週の表示: 時刻 × 曜日のマス目に、SNS の色の札を置く（見本 C）。空いているマスを押すと、その日の投稿をつくる
export function WeekGrid({
  days,
  today,
  posts,
  todosByDay,
  base,
}: {
  days: string[];
  today: string;
  posts: PostRow[];
  todosByDay: Map<string, CalendarTodo[]>;
  base: string;
}) {
  const cells = new Map<string, PostRow[]>();
  const hours = new Set(BASE_HOURS);
  for (const p of posts) {
    const hour = Number(formatTime(p.planned_at!).slice(0, 2));
    hours.add(hour);
    const key = `${toYmd(new Date(p.planned_at!))}-${hour}`;
    cells.set(key, [...(cells.get(key) ?? []), p]);
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
          <div className="border-r border-line bg-surface2 px-1 py-2 text-center text-[12px] text-faint">やること</div>
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
            return (
              <div key={d} className={`group relative flex min-h-[52px] min-w-0 flex-col gap-1 p-1.5 ${i < 6 ? "border-r border-line" : ""} ${d === today ? "bg-surface2/60" : ""}`}>
                {/* 空いているところを押すと、その日の投稿をつくる（札は、この上に重ねる） */}
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
                      href={`${base}/posts/${p.id}`}
                      sns={p.targets.map((t) => t.sns)}
                      status={displayStatus(p)}
                      time={time.endsWith(":00") ? undefined : time}
                      title={postTitle(p.body, 24)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
