import type { ReactNode } from "react";
import { chartTicks, peakIndex, shortDay, type Daily } from "@/lib/overview/numbers";
import { weekdayLabel } from "@/lib/time";

// 日ごとの棒グラフ（見本 A の「ダウンロード推移」）。左に縦の目盛り（いちばん大きい日・その半分・0）と横の線、棒の上にその日の数（0 の日は出さない）。
// いちばん大きい日を濃くする（最後の日＝今日は 0 で棒がないことが多いため）。いちばん新しい日の数は見出しの右に文で出す（latestAside）。
// arrived: 遅れて届く数字（ストアのダウンロードなど）の届いているいちばん新しい日。それより後の日は 0 ではなく「未確定」の点線の枠にする
export function DailyBars({ rows, height = "h-44", label, arrived }: { rows: Daily[]; height?: string; label: string; arrived?: string | null }) {
  const pending = (day: string) => arrived !== undefined && (arrived === null || day > arrived);
  const known = rows.map((r) => (pending(r.day) ? { ...r, value: 0 } : r));
  const { top, ticks } = chartTicks(known);
  const peak = peakIndex(known);
  // 細い幅でも数を出す日: いちばん大きい日と、届いているいちばん新しい日
  const last = known.findLastIndex((r) => !pending(r.day));
  const anyPending = rows.some((r) => pending(r.day));
  const end = rows.length - 1;
  const days = rows.length > 7 ? [0, Math.floor(end / 2), end] : rows.map((_, i) => i);
  // 棒が細い幅では、いちばん大きい日と最後の日の数だけ出す（7 日を超えるとスマホで、15 日を超えると狭い PC でも重なる）
  const crowd = rows.length > 14 ? "max-lg:hidden" : rows.length > 7 ? "max-sm:hidden" : "";
  const pct = (v: number) => (v / top) * 100;
  return (
    <figure className="grid grid-cols-[auto_1fr] gap-x-1.5 gap-y-2" aria-label={label}>
      {/* 縦の目盛り（幅はいちばん長い数で決める） */}
      <div className={`relative ${height} text-[10px] leading-none text-faint`} aria-hidden>
        <span className="num invisible">{top.toLocaleString("ja-JP")}</span>
        <div className="absolute inset-x-0 top-4 bottom-0">
          {ticks.map((t) => (
            <span key={t} className="num absolute right-0 translate-y-1/2" style={{ bottom: `${pct(t)}%` }}>
              {t.toLocaleString("ja-JP")}
            </span>
          ))}
        </div>
      </div>
      <div className={`relative ${height}`}>
        {/* 上に棒の数の分をあける */}
        <div className="absolute inset-x-0 top-4 bottom-0">
          {ticks.map((t) => (
            <div key={t} aria-hidden className={`absolute inset-x-0 border-t border-line ${t === 0 ? "" : "border-dashed"}`} style={{ bottom: `${pct(t)}%` }} />
          ))}
          <ol className="absolute inset-0 flex items-end gap-[2.5%] px-1">
            {rows.map((r, i) =>
              pending(r.day) ? (
                <li key={r.day} className="relative flex h-full flex-1 items-end" title={`${shortDay(r.day)}: 未確定（まだ届いていません）`}>
                  <span className="block h-full w-full rounded-t-[3px] border border-b-0 border-dashed border-faint/35" />
                  <span className="sr-only">{shortDay(r.day)} 未確定</span>
                </li>
              ) : (
              <li key={r.day} className="relative flex h-full flex-1 items-end" title={`${shortDay(r.day)}: ${r.value.toLocaleString("ja-JP")}`}>
                {r.value > 0 && (
                  <span
                    aria-hidden
                    className={`num absolute inset-x-[-50%] mb-0.5 text-center text-[10px] leading-none ${i === peak ? "font-bold text-fg" : "text-muted"} ${i === peak || i === last ? "" : crowd}`}
                    style={{ bottom: `${pct(r.value)}%` }}
                  >
                    {r.value.toLocaleString("ja-JP")}
                  </span>
                )}
                <span
                  className={`block w-full rounded-t-[3px] ${i === peak ? "bg-info" : "bg-info/40"}`}
                  style={{ height: `${Math.max(r.value > 0 ? 2 : 0, pct(r.value))}%` }}
                />
                <span className="sr-only">
                  {shortDay(r.day)} {r.value}
                </span>
              </li>
              ),
            )}
          </ol>
        </div>
      </div>
      <div aria-hidden />
      <div className="relative h-4 px-1 text-xs text-faint" aria-hidden>
        {rows.length > 7 ? (
          days.map((t, k) => (
            <span
              key={t}
              className="num absolute"
              style={k === 0 ? { left: 4 } : k === days.length - 1 ? { right: 4 } : { left: `${((t + 0.5) / rows.length) * 100}%`, transform: "translateX(-50%)" }}
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
      {anyPending && (
        <>
          <div aria-hidden />
          <p className="flex items-center gap-1.5 px-1 text-xs text-faint">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[2px] border border-dashed border-faint/35" />
            未確定（まだ届いていない日）
          </p>
        </>
      )}
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
