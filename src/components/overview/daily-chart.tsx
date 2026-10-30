import type { ReactNode } from "react";
import { shortDay, type Daily } from "@/lib/overview/numbers";
import { weekdayLabel } from "@/lib/time";

// 日ごとの棒グラフ（見本 A の「ダウンロード推移」）。最後の日（今日）だけ濃くし、その日の数を上に出す
export function DailyBars({ rows, height = "h-44", label }: { rows: Daily[]; height?: string; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const last = rows.length - 1;
  const ticks = rows.length > 7 ? [0, Math.floor(last / 2), last] : rows.map((_, i) => i);
  return (
    <figure className="flex flex-col gap-2" aria-label={label}>
      <div className={`relative ${height}`}>
        {/* 目盛りの線（下は実線、上 2 本は点線） */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 border-t border-line" />
        <div aria-hidden className="absolute inset-x-0 top-1/3 border-t border-dashed border-line" />
        <div aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <ol className="absolute inset-0 flex items-end gap-[2.5%] px-1 pt-5">
          {rows.map((r, i) => (
            <li key={r.day} className="relative flex h-full flex-1 items-end" title={`${shortDay(r.day)}: ${r.value.toLocaleString("ja-JP")}`}>
              {i === last && (
                <span className="num absolute inset-x-0 -top-0.5 -translate-y-full text-center text-xs text-muted">{r.value.toLocaleString("ja-JP")}</span>
              )}
              <span
                className={`block w-full rounded-t-[3px] ${i === last ? "bg-info" : "bg-info/40"}`}
                style={{ height: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%` }}
              />
              <span className="sr-only">
                {shortDay(r.day)} {r.value}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="relative h-4 px-1 text-xs text-faint" aria-hidden>
        {rows.length > 7 ? (
          ticks.map((t, k) => (
            <span
              key={t}
              className="num absolute"
              style={k === 0 ? { left: 4 } : k === ticks.length - 1 ? { right: 4 } : { left: `${((t + 0.5) / rows.length) * 100}%`, transform: "translateX(-50%)" }}
            >
              {shortDay(rows[t].day)}
            </span>
          ))
        ) : (
          <span className="flex gap-[2.5%]">
            {rows.map((r) => (
              <span key={r.day} className="num flex-1 text-center">
                {weekdayLabel(r.day)}
              </span>
            ))}
          </span>
        )}
      </div>
    </figure>
  );
}

// グラフの代わりの空の案内（グラフと同じ高さの枠の中に、小さく）
export function ChartEmpty({ height = "h-44", children }: { height?: string; children: ReactNode }) {
  return (
    <div className={`flex ${height} flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-4 text-center text-sm text-muted`}>
      {children}
    </div>
  );
}
