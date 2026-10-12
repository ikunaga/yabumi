"use client";

import Link from "next/link";
import { useState } from "react";
import { StatusMark } from "@/components/ui/marks";
import { MARK, type MonthDay } from "./month-types";

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
const MAX_DOTS = 3;

// スマホの月の表示: マスには日付と印（点）だけを出し、押した日の投稿を下に並べる（マスが小さく、文字を入れると読めないため）
export function MonthMobile({ days, base, initial }: { days: MonthDay[]; base: string; initial: string }) {
  const [selected, setSelected] = useState(initial);
  const day = days.find((d) => d.ymd === selected) ?? days[0];
  const rest = day.count - day.items.length;
  const [m, d] = [Number(day.ymd.slice(5, 7)), day.day];
  const weekday = WEEKDAYS[days.indexOf(day) % 7];

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1 text-center text-[11px] text-muted">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((c, i) => {
            const isSelected = c.ymd === day.ymd;
            return (
              <button
                key={c.ymd}
                type="button"
                onClick={() => setSelected(c.ymd)}
                aria-pressed={isSelected}
                aria-label={`${Number(c.ymd.slice(5, 7))} 月 ${c.day} 日${c.isToday ? "（今日）" : ""}、投稿 ${c.count} 件`}
                className={`flex h-14 min-w-0 flex-col items-center gap-1 pt-1.5 ${i % 7 < 6 ? "border-r" : ""} ${i < 35 ? "border-b" : ""} border-line ${
                  isSelected ? "bg-primary-soft" : ""
                }`}
              >
                <span
                  className={`grid size-6 place-items-center rounded-full text-xs ${
                    c.isToday ? "bg-primary font-bold text-on-primary" : c.inMonth ? "text-fg" : "text-muted opacity-60"
                  } ${isSelected && !c.isToday ? "font-bold text-primary" : ""}`}
                >
                  {c.day}
                </span>
                <span className="flex h-2 items-center gap-0.5" aria-hidden>
                  {c.items.slice(0, MAX_DOTS).map((it) => (
                    <span key={it.id} className={`size-1.5 rounded-full ${MARK[it.status].dot}`} />
                  ))}
                  {c.count > MAX_DOTS && <span className="text-[10px] leading-none text-muted">+</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-hidden>
        {(["scheduled", "posted", "draft", ...(days.some((c) => c.items.some((it) => it.status === "failed")) ? (["failed"] as const) : [])] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={`size-1.5 rounded-full ${MARK[s].dot}`} />
            {MARK[s].label}
          </span>
        ))}
      </div>

      <section className="flex flex-col gap-1.5" aria-live="polite">
        <h2 className={`text-xs font-bold ${day.isToday ? "text-primary" : "text-muted"}`}>
          {m}/{d}（{weekday}）{day.isToday && " 今日"}
        </h2>
        {day.items.map((it) => (
          <Link key={it.id} href={it.href} className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-3 hover:no-underline">
            <span className="flex justify-between gap-2 text-xs">
              <span className="text-muted">
                {it.time} ・ {it.sns}
              </span>
              <StatusMark status={it.status} />
            </span>
            <span className="text-[14px]">{it.title}</span>
            {it.warning && <span className="text-xs font-semibold text-signal">{it.warning}</span>}
          </Link>
        ))}
        {rest > 0 && (
          <Link href={`${base}/calendar?view=week&week=${day.ymd}`} className="text-sm font-semibold text-primary">
            ほか {rest} 件を週の表示で見る
          </Link>
        )}
        <Link
          href={`${base}/compose?date=${day.ymd}`}
          className="rounded-lg border-[1.5px] border-dashed border-border px-3.5 py-3 text-sm text-muted hover:no-underline"
        >
          {day.count === 0 ? "空いています ・ " : ""}＋ この日の投稿をつくる
        </Link>
      </section>
    </div>
  );
}
