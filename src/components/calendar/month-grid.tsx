import Link from "next/link";
import type { WeekBand } from "@/lib/calendar/roadmap-view";
import { monthOf } from "@/lib/time";
import { TodoButton, WeekBandView } from "./roadmap-band";
import { MARK, type MonthDay } from "./month-types";

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
// 1 日のマスに出す件数。これより多い日は、1 つ減らして「ほか n 件」を出す（マスの高さをそろえる）
const MAX_ITEMS = 3;

// PC の月の表示: 月曜はじまりの 6 週のマス。前後の月の日は薄く。
// 日付を押すとその日の週の表示へ、投稿を押すとその投稿へ、空いているところを押すとその日の投稿をつくる。
// 各週の行の上に、ロードマップのやることと週の目標の帯を出す（bands は週の行の順）
export function MonthGrid({ days, base, bands, today }: { days: MonthDay[]; base: string; bands: (WeekBand | undefined)[]; today: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-1.5 text-center text-xs text-muted">
            {w}
          </div>
        ))}
      </div>
      {Array.from({ length: days.length / 7 }, (_, row) => (
        <div key={row} className={row < days.length / 7 - 1 ? "border-b border-line" : ""}>
          <WeekBandView band={bands[row]} base={base} today={today} compact />
          <div className="grid grid-cols-7 border-t border-line first:border-t-0">
        {days.slice(row * 7, row * 7 + 7).map((d, col) => {
          const i = row * 7 + col;
          const shown = d.count > MAX_ITEMS ? d.items.slice(0, MAX_ITEMS - 1) : d.items.slice(0, MAX_ITEMS);
          const more = d.count - shown.length;
          return (
            <div
              key={d.ymd}
              className={`group relative flex min-h-[116px] min-w-0 flex-col gap-0.5 p-1.5 ${i % 7 < 6 ? "border-r" : ""} border-line ${d.isToday ? "bg-surface2" : ""}`}
            >
              {/* 空いているところを押すと、その日の投稿をつくる（日付と投稿のリンクは、この上に重ねる） */}
              <Link
                href={`${base}/compose?date=${d.ymd}`}
                className="absolute inset-0 flex items-end justify-end p-1.5 text-xs text-muted hover:bg-primary-soft/50 hover:no-underline"
              >
                <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">＋ 投稿をつくる</span>
                <span className="sr-only">
                  {monthOf(d.ymd)} 月 {d.day} 日に投稿をつくる
                </span>
              </Link>
              <Link
                href={`${base}/calendar?view=week&week=${d.ymd}`}
                title="この日の週を見る"
                className={`relative z-10 grid size-6 place-items-center self-start rounded-full text-xs hover:no-underline ${
                  d.isToday ? "bg-primary font-bold text-on-primary" : d.inMonth ? "text-fg hover:bg-primary-soft" : "text-muted opacity-60 hover:bg-primary-soft"
                }`}
              >
                {d.day}
                {d.isToday && <span className="sr-only">今日</span>}
              </Link>
              {d.todos.map((t) => (
                <TodoButton key={t.id} todo={t} base={base} variant="day" />
              ))}
              {shown.map((it) => (
                <Link
                  key={it.id}
                  href={it.href}
                  title={it.title}
                  className={`relative z-10 truncate rounded-sm px-1 py-px text-xs leading-5 hover:bg-surface2 hover:no-underline ${d.inMonth ? "text-fg" : "text-muted opacity-60"}`}
                >
                  <span className={MARK[it.status].className}>{MARK[it.status].char}</span>
                  <span className="sr-only">{MARK[it.status].label}</span> {it.time} {it.sns}
                </Link>
              ))}
              {more > 0 && (
                <Link
                  href={`${base}/calendar?view=week&week=${d.ymd}`}
                  className="relative z-10 self-start rounded-sm px-1 text-xs leading-5 font-semibold text-primary hover:bg-primary-soft hover:no-underline"
                >
                  ほか {more} 件
                </Link>
              )}
            </div>
          );
        })}
          </div>
        </div>
      ))}
    </div>
  );
}
