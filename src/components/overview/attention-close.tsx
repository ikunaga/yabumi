"use client";

// 概要の「● 要確認」の帯の × と、閉じたら帯ごと消す外枠（4.71）。閉じたことはサーバーに持つ（スマホと PC で揃える）
import { useState, useTransition, type ReactNode } from "react";
import { BandCloseButton } from "@/components/ui/band-close";
import { closeAttention } from "@/lib/attention/actions";
import type { AttentionItem } from "@/lib/attention/dismissals";

const FAILED = "閉じられませんでした。画面を読み込み直してください。";

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
      <BandCloseButton
        label="要確認を閉じる"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            // 通信そのものが失敗しても、画面全体をエラーにしない（帯の中に出す。PMO の pc7）
            try {
              const r = await closeAttention(projectId, items);
              if (r.error) setError(r.error);
              else setClosed(true);
            } catch {
              setError(FAILED);
            }
          })
        }
      />
    </div>
  );
}
