import type { ReactNode } from "react";

// 小さな帯: 1 行の見出しとボタン（「いまやること」など。2026-10-30 オーナーの決定）。
// 説明は帯に並べず、help（<HelpTip />）や <Disclosure /> に畳む。黒い大きな面は使わない
export function ActionBar({
  label,
  title,
  help,
  action,
  className = "",
}: {
  // 小さな札（「いまやること 1/4」）
  label?: ReactNode;
  title: ReactNode;
  help?: ReactNode;
  // 右のボタン（<ButtonLink size="sm" />）
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-border bg-surface px-6 py-3.5 max-sm:flex-wrap max-sm:px-4 ${className}`}
    >
      {label && <span className="shrink-0 rounded-full bg-subtle px-2.5 py-0.5 text-xs font-bold text-muted">{label}</span>}
      <p className="min-w-0 flex-1 truncate text-[16px] font-bold max-sm:basis-[calc(100%-6rem)]">{title}</p>
      {help}
      {action && <div className="shrink-0 max-sm:w-full [&>*]:max-sm:w-full">{action}</div>}
    </div>
  );
}
