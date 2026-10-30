import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

// 相談の会話の右の列: この相談で採用した案の数と、一覧・新しい相談への入口（会話は読みやすい幅のまま左に置く）
export function ConsultSide({ projectId, adopted, lead }: { projectId: string; adopted: number | null; lead?: string | null }) {
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
        <p className="text-[14px] leading-[1.75] text-muted">{lead ?? "AI はアカウント設計・最近の投稿・数字・ロードマップを見たうえで、案を 2〜3 個出します。選んだ案だけが、設計やロードマップに入ります。"}</p>
        <div className="flex flex-wrap gap-2.5">
          <Link href={base} className={buttonClass({ variant: "secondary", size: "sm" })}>
            相談の一覧へ
          </Link>
          <Link href={`${base}/new`} className={buttonClass({ variant: "text", size: "sm" })}>
            新しい相談
          </Link>
        </div>
      </div>
    </Card>
  );
}
