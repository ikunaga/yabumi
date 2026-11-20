import type { ComponentProps, ReactNode } from "react";

// 開く欄（一覧の続き・任意の設定・例・長い説明や手順など）。幅いっぱいのボタンの中央に「〇〇を表示（件数）⌄」を出し、開くと ⌃ にする。
// 中身はボタンの下に出す。<details> なので、キーボード（Enter・Space）と読み上げで開け閉めできる（2026-11-20 オーナーの指示・案 E）
// label: 中身がわかる「〇〇を表示」「〇〇の説明を表示」の形で書く（「くわしく」だけにしない）。count: 件数（任意）
// size: sm は文の補足向け（高さを抑え、文字を小さく）。中身も補足の文の見た目（14px・muted）にする
// onSubtle: 置く面が bg-subtle のとき（地と区別がつくように、ボタンを bg-surface にする）
// 枠は border-input（カードの枠より一段濃い）。ライトでは bg-subtle と画面の地（bg）の色が近いので、枠で区別をつける（2026-11-20 オーナーの指示）
// 「?」の短い説明は HelpTip を使う
export function DisclosureBox({
  label,
  count,
  children,
  className = "",
  size = "md",
  bodyClassName,
  onSubtle = false,
  ...rest
}: Omit<ComponentProps<"details">, "children"> & {
  label: ReactNode;
  count?: ReactNode;
  children: ReactNode;
  size?: "md" | "sm";
  bodyClassName?: string;
  onSubtle?: boolean;
}) {
  const sm = size === "sm";
  return (
    <details className={className} {...rest}>
      <summary
        className={`flex cursor-pointer list-none items-center justify-center gap-1.5 border border-input text-center font-semibold text-fg [&::-webkit-details-marker]:hidden ${sm ? "rounded-md px-3 py-1.5 text-xs" : "rounded-lg px-4 py-2.5 text-[13px]"} ${onSubtle ? "bg-surface hover:bg-subtle" : "bg-subtle hover:bg-subtle-hover"}`}
      >
        <span className="min-w-0">
          {label}
          {count !== undefined && count !== null && <span className="num">（{count}）</span>}
        </span>
        <DisclosureChevron className={sm ? "size-3.5" : "size-4"} />
      </summary>
      <div className={bodyClassName ?? (sm ? "mt-2 text-[14px] leading-[1.75] text-muted" : "mt-2")}>{children}</div>
    </details>
  );
}

// 開く欄の ⌄（開くと ⌃）。<summary> の直下に置く。行ごとに開く欄（見出しに名前や数字を並べた行）では、行の右端に置く
export function DisclosureChevron({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`shrink-0 text-muted transition-transform [details[open]>summary>&]:rotate-180 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
