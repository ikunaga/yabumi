import type { ReactNode } from "react";

// 中身の 2 列（見本 A の左広・右狭。左 1.62 : 右 1）。広い画面（xl、1280px〜）だけ 2 列にし、それより狭いと縦に積む。
// 中身の左右の端は上の帯とそろえる（画面の枠 ProjectShell の余白のまま。画面ごとに max-w で狭めない）。
// sideFirst: 縦に積むとき右の列を先に出す（進み具合や主な操作を上に見せたいとき）
export function Columns({ main, side, sideFirst = false, className = "" }: { main: ReactNode; side: ReactNode; sideFirst?: boolean; className?: string }) {
  return (
    <div className={`grid items-start gap-5 max-sm:gap-4 xl:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)] ${className}`}>
      <div className="flex min-w-0 flex-col gap-5 max-sm:gap-4">{main}</div>
      <aside className={`flex min-w-0 flex-col gap-5 max-sm:gap-4 ${sideFirst ? "max-xl:order-first" : ""}`}>{side}</aside>
    </div>
  );
}
