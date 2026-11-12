"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setItemStatus } from "@/lib/roadmap/actions";

// 概要の「今週のやること」から、数字で数えないやること（プロフィールに置く・振り返るなど、yabumi の外で済ませるもの）を済みにする。
// 押すと帯は次のやることを先頭にする（setItemStatus が概要を作り直す）。取り消しはロードマップの画面のチェックで。
// 2026-11-12 PMO の通しテスト: 帯から済みにする手段がなく、ロードマップのチェックに気づかないと「済んでいるのに反映されない」になった
export function MarkDoneButton({ projectId, itemId, title, variant = "button" }: { projectId: string; itemId: string; title: string; variant?: "button" | "link" }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = () =>
    startTransition(async () => {
      setError(null);
      const res = await setItemStatus(projectId, itemId, "done");
      if (res.error) setError(res.error);
    });
  return (
    <>
      {variant === "button" ? (
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={run} aria-label={`「${title}」を済みにする`}>
          済みにする
        </Button>
      ) : (
        <button type="button" disabled={pending} onClick={run} aria-label={`「${title}」を済みにする`} className="text-xs text-muted underline hover:text-fg disabled:opacity-50">
          済みにする
        </button>
      )}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
}
