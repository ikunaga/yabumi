"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export type CalendarView = "week" | "month";

// 最後に選んだ表示（週・月）を、この端末に覚える。読めない・書けないとき（プライベートブラウズなど）は週のまま
const STORAGE_KEY = "yabumi:calendar-view";

function readStored(): CalendarView | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "week" || v === "month" ? v : null;
  } catch {
    return null;
  }
}

function store(view: CalendarView) {
  try {
    localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // 覚えられなくても、切り替えはできる
  }
}

// 見出しの横の「週 / 月」。表示は URL（?view=）に持つので、戻る・共有で同じ表示になる。
// 覚えるのは、この切り替えを押したときだけ（予約したあとの週の表示への戻りなどでは変えない）。
// URL で表示を指定していない（サイドの「カレンダー」から来た）ときだけ、最後に選んだ表示に合わせる
export function CalendarViewSwitch({ current, weekHref, monthHref, explicit }: { current: CalendarView; weekHref: string; monthHref: string; explicit: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (explicit || current === "month" || readStored() !== "month") return;
    // 「予約しました」などの知らせ（?done=）は残す
    const keep = new URLSearchParams(window.location.search);
    router.replace(keep.size ? `${monthHref}&${keep}` : monthHref);
  }, [explicit, current, monthHref, router]);

  const item = (view: CalendarView, href: string, label: string) => (
    <Link
      href={href}
      aria-current={current === view ? "page" : undefined}
      onClick={() => store(view)}
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
