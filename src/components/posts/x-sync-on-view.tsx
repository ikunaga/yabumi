"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { syncXPostStatus } from "@/lib/sns/x/sync-actions";

// 投稿の画面を開いたあとに、X の投稿がまだあるかを確かめる（24 時間に 1 回まで。docs/architecture.md の 4.13）。
// サーバー側の描画で確かめると、リンクの先読みのたびに費用がかかりうるので、ブラウザで開いたときだけ呼ぶ。
// 消されていたら、画面を読み直して「X で消されていました」を出す
export function XSyncOnView({ projectId, postId }: { projectId: string; postId: string }) {
  const router = useRouter();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    syncXPostStatus(projectId, postId)
      .then((r) => {
        if (r.changed) router.refresh();
      })
      .catch(() => {});
  }, [projectId, postId, router]);
  return null;
}
