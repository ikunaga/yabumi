"use client";

import { useEffect, useRef } from "react";

// コメントを表示したあとに「見た」にする（docs/architecture.md の 4.70）。サーバーの描画では呼ばない（リンクの先読みで見たことにしないため）。
// この回の表示は「● 新しい」のまま（画面を読み直さない受け口を呼ぶ）。次に開いたときに消える
export function MarkCommentsSeen({ projectId, postId }: { projectId: string; postId?: string }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch("/api/comments/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, postId }) }).catch(() => {});
  }, [projectId, postId]);
  return null;
}
