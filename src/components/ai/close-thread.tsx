"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { closeConsultThreadAction } from "@/lib/ai/consult-actions";
import { callAction } from "@/lib/client-errors";

// 相談を終える（済みにして、元の画面に戻る。docs/architecture.md の 4.23）。AI の区切りの「これで終わる」と、右の欄の「この相談を終える」で使う
export function useCloseThread(projectId: string, threadId: string | null) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function close() {
    if (!threadId) return;
    setError(null);
    startTransition(async () => {
      // うまくいけば、サーバーが元の画面に移す（redirect）
      const r = await callAction(() => closeConsultThreadAction(projectId, threadId));
      if (!r.ok) setError(r.failure.message);
      else if (r.value?.error) setError(r.value.error);
    });
  }
  return { close, pending, error };
}

// 右の「この相談」の欄の「この相談を終える」。押すと確かめてから終える（終えると、この相談には送れなくなる）
export function CloseThreadButton({ projectId, threadId }: { projectId: string; threadId: string }) {
  const [confirm, setConfirm] = useState(false);
  const { close, pending, error } = useCloseThread(projectId, threadId);
  if (!confirm) {
    return (
      <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setConfirm(true)}>
        この相談を終える
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface2 p-3 text-sm">
      <p className="leading-[1.7]">
        終えると、この相談には送れなくなります（読むことはできます）。<span className="text-muted">採用した案はそのまま残ります。</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={close}>
          終える
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setConfirm(false)}>
          やめる
        </Button>
      </div>
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
