import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-border bg-surface ${className}`}>{children}</section>;
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-6 pt-5 pb-2 max-sm:px-4 max-sm:pt-4">
      <h2 className="text-[18px] font-bold max-sm:text-[16px]">{title}</h2>
      {action && <div className="text-[15px] text-faint">{action}</div>}
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
