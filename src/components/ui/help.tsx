import type { ReactNode } from "react";
import { DismissableDetails } from "./dismissable-details";

// 「?」を押すと出る短い説明（説明を画面に並べずに畳む。2026-10-30 オーナーの決定）。
// 用語の解説は <Term />（点線）、長い説明や手順は <Disclosure />（開く欄）を使う
export function HelpTip({ label = "説明", children, align = "left" }: { label?: string; children: ReactNode; align?: "left" | "right" }) {
  return (
    <DismissableDetails className="group relative inline-block shrink-0 align-middle">
      <summary className="flex size-5 cursor-pointer list-none items-center justify-center rounded-full border border-input text-[11px] leading-none font-bold text-muted hover:border-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <span aria-hidden>?</span>
        <span className="sr-only">{label}を見る</span>
      </summary>
      <div
        className={`absolute z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg bg-pop px-4 py-3 text-[13px] leading-[1.7] font-normal text-on-pop shadow-pop ${align === "right" ? "right-0" : "left-0"}`}
      >
        {children}
      </div>
    </DismissableDetails>
  );
}

// 開くと出る欄（「くわしく」）。手順や長い説明をしまっておく
export function Disclosure({ summary = "くわしく", children, className = "" }: { summary?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={`group ${className}`}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <svg aria-hidden viewBox="0 0 12 12" className="size-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 3 7.5 6 4.5 9" />
        </svg>
        {summary}
      </summary>
      <div className="mt-2 text-[14px] leading-[1.75] text-muted">{children}</div>
    </details>
  );
}
