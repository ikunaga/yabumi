import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { formatShort } from "@/lib/time";
import { CloseThreadButton } from "./close-thread";

// 相談の会話の右の列: この相談で採用した案の数、この相談を終える、一覧・新しい相談への入口（会話は読みやすい幅のまま左に置く）
export function ConsultSide({
  projectId,
  adopted,
  lead,
  threadId = null,
  closedAt = null,
  aiBlocked = false,
}: {
  projectId: string;
  adopted: number | null;
  lead?: string | null;
  // 会話を始めたあと（終えるボタンを出す）
  threadId?: string | null;
  // 済んだ日時（済んだ会話）
  closedAt?: string | null;
  // AI の枠を使い切っている（新しい相談を始められない）
  aiBlocked?: boolean;
}) {
  const base = `/projects/${projectId}/consult`;
  return (
    <Card>
      <CardHeader title="この相談" />
      <div className="flex flex-col gap-4 px-6 pt-1 pb-5 max-sm:px-4">
        {adopted !== null && (
          <p className="num text-[15px] text-faint">
            採用した案 <b className="text-metric leading-none text-fg">{adopted}</b> 件
          </p>
        )}
        {closedAt && (
          <p className="flex items-center gap-2 text-[14px] text-muted">
            <Badge>完了</Badge>
            <span className="num">{formatShort(closedAt)}</span>
          </p>
        )}
        <p className="text-[14px] leading-[1.75] text-muted">{lead ?? "AI は、アカウントの方針・最近の投稿と数字・目標と週ごとのやることを見ます。そのうえで、案を 2〜3 個出します。選んだ案だけを、アカウントの方針や、目標と週ごとのやることに追加します。"}</p>
        {threadId && !closedAt && <CloseThreadButton projectId={projectId} threadId={threadId} />}
        <div className="flex flex-wrap gap-2.5">
          <Link href={base} className={buttonClass({ variant: "secondary", size: "sm" })}>
            相談の一覧へ
          </Link>
          {aiBlocked ? (
            <span aria-disabled="true" className={buttonClass({ variant: "text", size: "sm", className: "cursor-not-allowed text-faint" })}>
              新しい相談
            </span>
          ) : (
            <Link href={`${base}/new`} className={buttonClass({ variant: "text", size: "sm" })}>
              新しい相談
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}
