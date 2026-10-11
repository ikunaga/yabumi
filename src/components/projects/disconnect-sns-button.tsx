"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectSnsAccount, type DisconnectResult } from "@/lib/sns/disconnect-actions";

// SNS 側でも外す方法の案内（アプリから解除できない SNS）
const AFTER_NOTE: Record<string, string> = {
  threads: "Threads の側からも矢書を外すときは、Threads のアプリの「設定 → アカウント → ウェブサイトのアクセス許可」から矢書を削除してください。",
  instagram: "Instagram の側からも矢書を外すときは、Instagram のアプリの「設定とアクティビティ → ウェブサイトのアクセス許可 → アプリとウェブサイト」から矢書を削除してください。",
  facebook: "Facebook の側からも矢書を外すときは、Facebook の「設定とプライバシー → 設定 → ビジネス統合」から矢書を削除してください。",
};

// 「つないだ SNS」の「外す」。先に、予約が残っていないかとほかのプロジェクトでの使い道を確かめてから外す
export function DisconnectSnsButton({ projectId, accountId, sns, label }: { projectId: string; accountId: string; sns: string; label: string }) {
  const [state, setState] = useState<DisconnectResult | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (confirmed: boolean) =>
    startTransition(async () => {
      setState(await disconnectSnsAccount(projectId, accountId, confirmed));
    });

  if (state?.done) {
    return (
      <span className="text-xs text-muted">
        外しました。
        {state.done.removedAccount && state.done.revoke === "failed" && "（X の側の取り消しに失敗しました。X の設定の「連携しているアプリ」から外せます）"}
        {state.done.removedAccount && AFTER_NOTE[sns]}
      </span>
    );
  }

  if (state?.preview) {
    const { pending: count, otherProjects } = state.preview;
    return (
      <span className="flex flex-col items-end gap-1.5 text-right text-xs">
        <span>
          {otherProjects > 0
            ? `このプロジェクトから ${label} を外します（ほかの ${otherProjects} 件のプロジェクトでは使い続けます）。`
            : `${label} を外し、保存しているトークンと、${label} から読んだ数字（閲覧数・フォロワーなど）、${label} 上の投稿へのリンクを消します。矢書で書いた投稿の本文と送った記録は残ります。`}
          {count > 0 && <b className="text-signal">予約中の投稿が {count} 件あり、送られなくなります。</b>}
        </span>
        <span className="flex gap-2">
          <Button type="button" variant="danger" size="sm" disabled={pending} onClick={() => run(true)}>
            外す
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setState(null)}>
            やめる
          </Button>
        </span>
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => run(false)}>
        外す
      </Button>
      {state?.error && (
        <span role="alert" className="text-xs font-semibold text-danger">
          {state.error}
        </span>
      )}
    </span>
  );
}
