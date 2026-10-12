"use client";

import { useEffect, useRef, useState } from "react";
import { DeleteThreadButton } from "./delete-thread-button";

// 会話の画面の見出しの横の「…」。会話の下に削除が混ざらないように、ここに置く
export function ThreadMenu(props: { projectId: string; threadId: string; backPath: string; keeps: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="この会話のメニュー"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-lg leading-none text-muted hover:bg-surface2"
      >
        …
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-border bg-surface p-2 shadow-pop max-sm:w-[calc(100vw-32px)]">
          <DeleteThreadButton {...props} />
        </div>
      )}
    </div>
  );
}
