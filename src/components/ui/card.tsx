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

// 空の状態: 点線の枠の中に、短い説明と次の一歩（概要の「日ごとの数」と同じ形）
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
    <div
      className={`mx-6 mt-1 mb-6 flex flex-col items-center gap-2.5 rounded-md border border-dashed border-border px-6 py-8 text-center max-sm:mx-4 max-sm:mb-4 max-sm:px-4 ${className}`}
    >
      {title && <p className="text-[17px] font-bold">{title}</p>}
      <p className="text-[14px] leading-[1.8] text-muted">{description}</p>
      {action && <div className="mt-1.5 max-sm:w-full">{action}</div>}
    </div>
  );
}
