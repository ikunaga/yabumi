"use client";

import Link from "next/link";
import { calendarViewCookie, type CalendarView } from "@/lib/calendar-view";

// 押した表示を、この端末に覚える（cookie。サーバーで読んで、次に表示を指定せずに開いたときに最初からその表示を出す）
function remember(view: CalendarView) {
  try {
    document.cookie = calendarViewCookie(view, location.protocol === "https:");
  } catch {
    // 覚えられなくても、切り替えはできる
  }
}

// 見出しの横の「週 / 月」。表示は URL（?view=）に持つので、戻る・共有で同じ表示になる。
// 覚えるのは、この切り替えを押したときだけ（予約したあとの週の表示への戻りなどでは変えない）
export function CalendarViewSwitch({ current, weekHref, monthHref }: { current: CalendarView; weekHref: string; monthHref: string }) {
  const item = (view: CalendarView, href: string, label: string) => (
    <Link
      href={href}
      aria-current={current === view ? "page" : undefined}
      onClick={() => remember(view)}
      className={`rounded px-3 py-1 hover:no-underline ${current === view ? "bg-primary font-bold text-on-primary" : "text-primary hover:bg-primary-soft"}`}
    >
      {label}
    </Link>
  );

  return (
    <div role="group" aria-label="表示の切り替え" className="inline-flex rounded-md border border-border bg-surface p-0.5 text-sm">
      {item("week", weekHref, "週")}
      {item("month", monthHref, "月")}
    </div>
  );
}
