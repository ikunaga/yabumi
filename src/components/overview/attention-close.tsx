"use client";

// 概要の「● 要確認」の帯の × と、閉じたら帯ごと消す外枠（4.71）。閉じたことはサーバーに持つ（スマホと PC で揃える）
import { useState, useTransition, type ReactNode } from "react";
import { closeAttention } from "@/lib/attention/actions";
import type { AttentionItem } from "@/lib/attention/dismissals";

export function AttentionFrame({ projectId, items, children }: { projectId: string; items: AttentionItem[]; children: ReactNode }) {
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (closed) return null;
  return (
    <div id="attention" className="flex scroll-mt-24 items-start gap-3 rounded-lg border border-border bg-surface px-5 py-3 max-sm:px-4">
      <div className="min-w-0 flex-1">
        {children}
        {error && <p className="mt-1 text-sm text-danger">{error}</p>}
      </div>
      <button
        type="button"
        aria-label="閉じる"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await closeAttention(projectId, items);
            if (r.error) setError(r.error);
            else setClosed(true);
          })
        }
        className="-my-1 -mr-2 shrink-0 rounded px-2 py-1 text-muted hover:text-fg disabled:opacity-50"
      >
        ✕
      </button>
    </div>
  );
}
