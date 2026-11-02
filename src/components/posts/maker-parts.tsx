import type { ReactNode } from "react";

// 画像をつくる画面（テンプレート・AI で写真）で使う、選ぶボタンとその見出し

export function Choice({ on, onClick, children, className = "" }: { on: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary-soft font-bold text-primary" : "border-border bg-surface text-fg hover:border-primary"} ${className}`}
    >
      {children}
    </button>
  );
}

export function Group({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-[14px] font-bold">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
      {hint && <p className="text-xs leading-[1.7] text-muted">{hint}</p>}
    </fieldset>
  );
}
