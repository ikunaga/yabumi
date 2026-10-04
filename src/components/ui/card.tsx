import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-border bg-surface ${className}`}>{children}</section>;
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5 max-sm:px-4 max-sm:py-3">
      <h2 className="text-base font-bold max-sm:text-[14px]">{title}</h2>
      {action && <div className="text-sm text-primary">{action}</div>}
    </div>
  );
}

// 空の状態: 帳面の罫線を敷く
export function EmptyState({
  title,
  description,
  action,
  className = "",
}: {
  title?: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-ruled flex flex-col items-start gap-2.5 px-5 py-8 ${className}`}>
      {title && <p className="text-lg font-bold">{title}</p>}
      <p className="text-[14px] leading-[1.8] text-muted">{description}</p>
      {action && <div className="mt-1.5 w-full sm:w-auto">{action}</div>}
    </div>
  );
}
