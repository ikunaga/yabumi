import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "text" | "danger" | "inverse";
type Size = "md" | "sm" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap transition-colors duration-[120ms] ease-out disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40";

const variants: Record<Variant, string> = {
  primary: "bg-primary font-bold text-on-primary hover:bg-primary-hover",
  secondary: "border border-primary font-semibold text-primary hover:bg-primary-soft",
  text: "text-muted hover:text-fg hover:underline",
  danger: "bg-danger font-bold text-surface hover:bg-danger-hover",
  inverse: "bg-on-primary font-bold text-primary hover:opacity-90",
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
