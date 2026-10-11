"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteAiThread } from "@/lib/ai/thread-actions";

// 「この会話を削除する」。押すと確かめてから削除する（元に戻せない）
export function DeleteThreadButton({ projectId, threadId, backPath, keeps }: { projectId: string; threadId: string; backPath: string; keeps: string }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirm) {
    return (
      <Button type="button" variant="text" size="sm" className="self-start" onClick={() => setConfirm(true)}>
        この会話を削除する
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
      <p>
        この会話をすべて削除します。元に戻せません。<span className="text-muted">{keeps}</span>
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
