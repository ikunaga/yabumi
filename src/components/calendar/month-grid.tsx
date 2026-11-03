import Link from "next/link";
import type { WeekBand } from "@/lib/calendar/roadmap-view";
import { monthCellLines } from "@/lib/calendar/month-cell";
import { monthOf } from "@/lib/time";
import { TodoButton, WeekBandView } from "./roadmap-band";
import type { MonthDay } from "./month-types";
import { SnsLabel } from "./sns-label";

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

// PC の月の表示: 月曜はじまりの 6 週のマス。前後の月の日は薄く。
// 日付を押すとその日の週の表示へ、投稿を押すとその投稿へ、空いているところか右上の「＋」を押すとその日の投稿をつくる。
// やることと投稿の札は合わせて 3 行まで。多い日は「ほか n 件」でその日の週の表示へ（4.39）。
// 各週の行の上に、ロードマップのやることと週の目標の帯を出す（bands は週の行の順）
export function MonthGrid({ days, base, bands, today }: { days: MonthDay[]; base: string; bands: (WeekBand | undefined)[]; today: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-line bg-surface2">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-[13px] text-faint">
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
          const { todos, items: shown, more } = monthCellLines(d.todos, d.items, d.count);
          return (
            <div
              key={d.ymd}
              className={`group relative flex min-h-[116px] min-w-0 flex-col gap-1 p-1.5 ${i % 7 < 6 ? "border-r" : ""} border-line ${d.isToday ? "bg-surface2" : ""}`}
            >
              {/* 空いているところを押すと、その日の投稿をつくる（日付と札は、この上に重ねる）。キーボードと読み上げは右上の「＋」から */}
              <Link
                href={`${base}/compose?date=${d.ymd}`}
                tabIndex={-1}
                aria-hidden
                className="absolute inset-0 hover:bg-primary-soft/50 hover:no-underline"
              />
              {/* 日付の行。右上の「＋」は札と重ならないよう、日付と同じ行に置き、マスにマウスを乗せたときに出す */}
              <div className="flex items-center justify-between">
                <Link
                  href={`${base}/calendar?view=week&week=${d.ymd}`}
                  title="この日の週を見る"
                  className={`relative z-10 grid size-6 place-items-center rounded-full text-xs hover:no-underline ${
                    d.isToday ? "bg-primary font-bold text-on-primary" : d.inMonth ? "text-fg hover:bg-primary-soft" : "text-muted opacity-60 hover:bg-primary-soft"
                  }`}
                >
                  {d.day}
                  {d.isToday && <span className="sr-only">今日</span>}
                </Link>
                <Link
                  href={`${base}/compose?date=${d.ymd}`}
                  title="この日の投稿をつくる"
                  className="relative z-10 grid size-6 place-items-center rounded-full text-sm text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-primary-soft hover:text-fg hover:no-underline focus-visible:opacity-100"
                >
                  <span aria-hidden>＋</span>
                  <span className="sr-only">
                    {monthOf(d.ymd)} 月 {d.day} 日に投稿をつくる
                  </span>
                </Link>
              </div>
              {todos.map((t) => (
                <TodoButton key={t.id} todo={t} base={base} variant="day" />
              ))}
              {shown.map((it) => (
                <SnsLabel key={it.id} href={it.href} sns={it.snsKeys} status={it.status} time={it.time} title={it.title} dim={!d.inMonth} />
              ))}
              {more > 0 && (
                <Link
                  href={`${base}/calendar?view=week&week=${d.ymd}`}
                  className="relative z-10 self-start rounded-sm px-1 text-xs leading-5 font-semibold text-muted underline hover:text-fg"
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
