"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "./button";

// フォームの送信ボタン。押した瞬間に押せない状態にして「〜しています…」を出す（押した感覚を返し、二重に送らない）。
// サーバーのアクションをそのまま action に渡すフォーム（useActionState を使わないもの）に使う。
// variant を渡すと Button と同じ見た目、渡さなければ className だけ（文字だけのリンク風のボタンなど）
export function SubmitButton({
  children,
  pendingText,
  variant,
  size,
  className = "",
}: {
  children: ReactNode;
  pendingText: ReactNode;
  variant?: "primary" | "secondary" | "text" | "danger";
  size?: "md" | "sm" | "lg";
  className?: string;
}) {
  const { pending } = useFormStatus();
  const look = variant ? buttonClass({ variant, size, className }) : `disabled:opacity-60 ${className}`;
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={look}>
      {pending ? pendingText : children}
    </button>
  );
}
