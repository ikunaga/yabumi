import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "text" | "danger" | "inverse";
type Size = "md" | "sm" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap transition-colors duration-[120ms] ease-out disabled:pointer-events-none aria-disabled:pointer-events-none";
// 押せないときは薄くする。主ボタン（黒・暗い表示では白）は薄くしても濃い面に見えて押せそうなので、灰の面と弱い文字にする
// （2026-11-12 PMO の通しのテスト「押せない見出しを重ねるが、色の濃い目立つボタンに見える」）
const faded = "disabled:opacity-40 aria-disabled:opacity-40";
const mutedFill = "disabled:bg-subtle disabled:text-faint aria-disabled:bg-subtle aria-disabled:text-faint";

const variants: Record<Variant, string> = {
  // 押すものは黒（決定 D33）。二番手は白地に灰の枠
  primary: `bg-primary font-bold text-on-primary hover:bg-primary-hover ${mutedFill}`,
  secondary: `border border-input bg-surface font-semibold text-fg hover:border-muted hover:bg-subtle ${faded}`,
  text: `text-muted hover:text-fg hover:underline ${faded}`,
  danger: `bg-danger font-bold text-surface hover:bg-danger-hover ${faded}`,
  // 暗い帯（bg-band）の中の主ボタン（白）
  inverse: `bg-on-band font-bold text-band hover:opacity-90 ${faded}`,
};

// md: 高さ 44 / sm: 高さ 32 / lg: スマホの主ボタン（高さ 52）
const sizes: Record<Size, string> = {
  md: "h-11 px-[22px] text-base",
  sm: "h-8 px-3.5 text-sm",
  lg: "h-13 px-6 text-base",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  className = "",
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  const pad = variant === "text" ? "px-2" : "";
  return `${base} ${variants[variant]} ${sizes[size]} ${pad} ${className}`;
}

type Common = { variant?: Variant; size?: Size };

export function Button({ variant, size, className, ...props }: ComponentProps<"button"> & Common) {
  return <button className={buttonClass({ variant, size, className })} {...props} />;
}

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & Common) {
  return <Link className={buttonClass({ variant, size, className })} {...props} />;
}

// まだ使えない機能のボタン。押せない状態で「準備中」を添える（CLAUDE.md の「デザイン」）。
// stack: ボタンの下に添える（黒の帯の中の主ボタンなど）。ふだんは右に添える
export function NotReadyButton({
  variant = "primary",
  size,
  className,
  stack = false,
  children,
}: Common & { className?: string; stack?: boolean; children: ReactNode }) {
  const note = variant === "inverse" ? "text-on-band-muted" : "text-muted";
  return (
    <span className={stack ? "flex flex-col items-center gap-1 max-sm:items-stretch" : "inline-flex flex-wrap items-center gap-2"}>
      <button type="button" disabled className={buttonClass({ variant, size, className })}>
        {children}
      </button>
      <span className={`text-xs ${note} ${stack ? "text-center" : ""}`}>準備中</span>
    </span>
  );
}
