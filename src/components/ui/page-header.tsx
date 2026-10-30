import type { ReactNode } from "react";
import { HelpTip } from "./help";

// 画面の見出し: 短い見出し ＋「?」（その画面の説明。畳んでおく）＋ 右のボタン。
// 説明を見出しの下に並べない（2026-10-30 オーナーの決定。docs/design/new_design/README.md）。
// sub は 1 行の添え書き（件数・期間など）だけに使う
export function PageHeader({
  title,
  help,
  sub,
  actions,
  className = "",
}: {
  title: ReactNode;
  help?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 ${className}`}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[28px] leading-tight font-bold max-sm:text-[24px]">{title}</h1>
          {help && <HelpTip label={typeof title === "string" ? `${title}の説明` : "説明"}>{help}</HelpTip>}
        </div>
        {sub && <p className="num text-[15px] text-faint">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5 max-sm:w-full">{actions}</div>}
    </div>
  );
}
