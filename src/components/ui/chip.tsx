import type { ComponentProps, ReactNode } from "react";

// チップ: 丸い小さな札。選べるもの（SNS の選択、絞り込み）は on で黒の枠と太字にする（見本 B・D）
export function chipClass({ on = false, className = "" }: { on?: boolean; className?: string } = {}) {
  const look = on ? "border-primary bg-surface font-bold text-fg" : "border-border bg-surface text-muted hover:border-input hover:text-fg";
  return `inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors duration-[120ms] ${look} ${className}`;
}

export function Chip({ on, className, ...props }: ComponentProps<"button"> & { on?: boolean }) {
  return <button type="button" aria-pressed={on} className={chipClass({ on, className })} {...props} />;
}

// 塗りのチップ（見本 D の「共通」）。いま選んでいる 1 つだけに使う
export function chipSolidClass(on: boolean) {
  return on
    ? "inline-flex h-8 items-center rounded-full bg-primary px-3.5 text-[13px] font-bold whitespace-nowrap text-on-primary"
    : "inline-flex h-8 items-center rounded-full border border-border bg-surface px-3.5 text-[13px] whitespace-nowrap text-muted hover:text-fg";
}

type Tone = "neutral" | "success" | "signal" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-muted",
  success: "bg-success-soft text-success",
  signal: "bg-signal-soft text-signal",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

// バッジ: 状態を表す小さな印（押せない）。押すものと見分けるため、枠ではなく薄い地で表す
export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs leading-[1.5] font-bold whitespace-nowrap ${tones[tone]} ${className}`}>{children}</span>;
}
