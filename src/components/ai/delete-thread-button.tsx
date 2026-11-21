"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteAiThread } from "@/lib/ai/thread-actions";

// 「この相談を削除する」「この会話を削除する」。押すと確かめてから削除する（元に戻せない）。noun: 画面での呼び方（AI と相談は「相談」、AI と考えるは「会話」。2026-11-21 PM の決定）
export function DeleteThreadButton({ projectId, threadId, backPath, keeps, noun = "会話" }: { projectId: string; threadId: string; backPath: string; keeps: string; noun?: "相談" | "会話" }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirm) {
    return (
      <Button type="button" variant="text" size="sm" className="self-start" onClick={() => setConfirm(true)}>
        この{noun}を削除する
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
      <p>
        この{noun}をすべて削除します。元に戻せません。<span className="text-muted">{keeps}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await deleteAiThread(projectId, threadId, backPath);
              if (res?.error) setError(res.error);
            })
          }
        >
          削除する
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setConfirm(false)}>
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
