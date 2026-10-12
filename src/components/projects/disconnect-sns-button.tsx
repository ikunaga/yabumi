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

// 確かめの文・結果・エラーは、行（flex-wrap）の下に全幅で出す。行の中に横に並べると、アカウント名と費用の列が押しつぶされるため。
// 左は SNS の名前の列（w-24 と gap-3）のぶんだけ空けて、アカウント名と揃える。スマホでは名前の列が 1 行目に乗るので空けない
const BELOW_ROW = "order-last basis-full pl-[108px] text-xs leading-[1.7] max-sm:pl-0";

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
      <span className={`${BELOW_ROW} text-muted`}>
        外しました。
        {state.done.removedAccount && state.done.revoke === "failed" && "（X の側の取り消しに失敗しました。X の設定の「連携しているアプリ」から外せます）"}
        {state.done.removedAccount && AFTER_NOTE[sns]}
      </span>
    );
  }

  if (state?.preview) {
    const { pending: count, otherProjects } = state.preview;
    return (
      <span className={`${BELOW_ROW} flex flex-col gap-2`}>
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
    <>
      <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => run(false)}>
        外す
      </Button>
      {state?.error && (
        <span role="alert" className={`${BELOW_ROW} font-semibold text-danger`}>
          {state.error}
        </span>
      )}
    </>
  );
}
