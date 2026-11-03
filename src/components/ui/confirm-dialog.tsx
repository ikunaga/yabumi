"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";

// 確かめるモーダル（取り返しのつかない操作の前に）。Esc・外側を押す・「やめる」で閉じ、閉じたら押したボタンにフォーカスを戻す（dialog の showModal の動き）。
// 確かめたあとに押したボタンが消えるときは、onConfirm の中で次のフォーカスの先を決める
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "やめる",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open, mounted]);

  if (!mounted) return null;
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // 外側（背景）を押したら閉じる
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg border border-border bg-surface p-5 text-fg shadow-pop backdrop:bg-scrim max-sm:p-4"
    >
      <div className="flex flex-col gap-3 text-[14px] leading-[1.7]">
        <h2 id={titleId} className="text-base font-bold">
          {title}
        </h2>
        {children}
        <div className="mt-1 flex flex-wrap items-center justify-end gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
          {/* 先にフォーカスが来るのは「やめる」（Enter で取り返しのつかない方を押さないように） */}
          <Button type="button" variant="secondary" autoFocus onClick={() => ref.current?.close()}>
            {cancelLabel}
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

const noopSubscribe = () => () => {};
