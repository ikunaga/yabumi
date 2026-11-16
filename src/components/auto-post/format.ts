import type { AutoSchedule } from "@/lib/auto-post/types";

// 画面の文（サーバーとブラウザの両方から使う）
export const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"] as const; // ISO 1〜7

// くり返しの規則の短い文（「週 2（火・金）19:00」「毎日 12:00」「2 週ごと 1（水）9:00」）
export function scheduleText(s: AutoSchedule): string {
  const days =
    s.weekdays.length === 7 && s.every_weeks === 1
      ? "毎日"
      : `${s.every_weeks > 1 ? `${s.every_weeks} 週ごと ` : "週 "}${s.weekdays.length}（${[...s.weekdays]
          .sort((a, b) => a - b)
          .map((d) => WEEKDAY_LABELS[d - 1])
          .join("・")}）`;
  return `${days} ${s.time}`;
}
