import type { ButtonHTMLAttributes } from "react";

// 概要の小さな帯（要確認・おすすめ・今日の用語）の「×」。形と大きさをそろえる。
// 押せる範囲はスマホで 44×44（PC は 32×32）。帯の高さを変えないよう、負の余白で外にはみ出させる
export function BandCloseButton({ label, className = "", ...rest }: { label: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-label" | "children">) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`-my-2.5 -mr-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-lg leading-none text-muted hover:bg-subtle hover:text-fg disabled:opacity-50 sm:-my-1.5 sm:-mr-2 sm:size-8 ${className}`}
      {...rest}
    >
      ×
    </button>
  );
}
