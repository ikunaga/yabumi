import type { ReactNode } from "react";

// エラー帯: フォームの先頭に出す
export function ErrorBanner({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div
      id={id}
      role="alert"
      tabIndex={-1}
      className="rounded-md border border-danger bg-danger-soft px-4 py-3 text-[14px] leading-[1.7] font-semibold text-danger outline-none"
    >
      {children}
    </div>
  );
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-md border border-success bg-success-soft px-4 py-3 text-[14px] leading-[1.7] font-semibold text-success"
    >
      {children}
    </div>
  );
}
