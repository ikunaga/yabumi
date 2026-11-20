import type { ComponentProps, ReactNode } from "react";

// 開く欄（一覧の続き・任意の設定・例など）。幅いっぱいのボタンの中央に「〇〇を表示（件数）⌄」を出し、開くと ⌃ にする。
// 中身はボタンの下に出す。<details> なので、キーボード（Enter・Space）と読み上げで開け閉めできる（2026-11-20 オーナーの指示・案 E）
// label: 中身がわかる「〇〇を表示」の形で書く。count: 件数（任意）
// onSubtle: 置く面が bg-subtle のとき（地と区別がつくように、ボタンを bg-surface にする）
// 「?」の説明は HelpTip、文の補足の「くわしく」は help.tsx の Disclosure を使う
export function DisclosureBox({
  label,
  count,
  children,
  className = "",
  bodyClassName = "mt-2",
  onSubtle = false,
  ...rest
}: Omit<ComponentProps<"details">, "children"> & {
  label: ReactNode;
  count?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  onSubtle?: boolean;
}) {
  return (
    <details className={className} {...rest}>
      <summary
        className={`flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-center text-[13px] font-semibold text-fg [&::-webkit-details-marker]:hidden ${onSubtle ? "bg-surface hover:bg-subtle" : "bg-subtle hover:bg-subtle-hover"}`}
      >
        <span className="min-w-0">
          {label}
          {count !== undefined && count !== null && <span className="num">（{count}）</span>}
        </span>
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="size-4 shrink-0 text-muted transition-transform [details[open]>summary>&]:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </summary>
      <div className={bodyClassName}>{children}</div>
    </details>
  );
}
