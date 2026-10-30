import type { ReactNode } from "react";

// 前と比べた増減（▲ 緑・▼ 赤・± 灰）。value は差（12.4 なら ▲12.4）。unit は「%」「pt」「件」など
export function Delta({ value, unit = "", digits = 1, className = "" }: { value: number; unit?: string; digits?: number; className?: string }) {
  const shown = Math.abs(value).toLocaleString("ja-JP", { maximumFractionDigits: digits });
  const look = value > 0 ? { mark: "▲", cls: "text-success", word: "増えた" } : value < 0 ? { mark: "▼", cls: "text-danger", word: "減った" } : { mark: "±", cls: "text-muted", word: "変わらない" };
  return (
    <span className={`num font-bold whitespace-nowrap ${look.cls} ${className}`}>
      <span aria-hidden>{look.mark}</span>
      <span className="sr-only">{look.word}</span>
      {value === 0 ? "0" : shown}
      {unit}
    </span>
  );
}

// 指標のカード: ラベル・大きく太い数字・添え書き（前と比べた増減など）。見本 A の上に並ぶ 4 つ
export function Metric({
  label,
  value,
  unit,
  delta,
  note,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  // 数字のあとに小さく添える単位（件・枠）
  unit?: ReactNode;
  // 前と比べた増減。<Delta /> を渡す
  delta?: ReactNode;
  // 添え書き（「前月比」「うち予約 84 件」）
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-3.5 ${className}`}>
      <p className="truncate text-[16px] text-muted">{label}</p>
      <p className="num mt-1.5 text-metric font-bold max-sm:text-[30px]">
        {value}
        {unit && <span className="ml-1 text-sm font-bold text-muted">{unit}</span>}
      </p>
      {(delta || note) && (
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[16px] text-faint">
          {delta}
          {note && <span>{note}</span>}
        </p>
      )}
    </div>
  );
}

// 横棒の 1 行（見本 A の「媒体別」）。barClass に色（SNS_COLOR[sns].bg、bg-info など）を渡す
export function BarRow({
  label,
  value,
  max,
  barClass = "bg-info",
  display,
}: {
  label: ReactNode;
  value: number;
  max: number;
  barClass?: string;
  // 右の数字の出し方（省略すると 3 桁区切り）
  display?: ReactNode;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-4 text-[17px] max-sm:grid-cols-[5rem_1fr_3.5rem] max-sm:text-sm">
      <span className="truncate text-muted">{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
        <span className={`block h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="num text-right text-[18px] font-bold">{display ?? value.toLocaleString("ja-JP")}</span>
    </div>
  );
}
