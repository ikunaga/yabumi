import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, chipClass } from "@/components/ui/chip";
import { Columns } from "@/components/ui/columns";
import { SuccessBanner } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { aiConfigured } from "@/lib/ai/anthropic";
import { isConsultTopic } from "@/lib/ai/consult";
import { listConsultThreads } from "@/lib/ai/consult-queries";
import { CONSULT_TOPIC_META, listedConsultTopics } from "@/lib/ai/consult-topics";
import { getProject } from "@/lib/projects/queries";
import { formatShort } from "@/lib/time";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "AI と相談" };

// AI と相談（F09、docs/architecture.md の 4.23）の一覧の画面: 上に新しい相談の入口、下にこれまでの相談。
// 会話そのものは /consult/[threadId]（新しい会話は /consult/new）。一覧と会話を同じ画面に置くとわかりにくい（オーナーの指摘、2026-10-12）
export default async function ConsultListPage(props: PageProps<"/projects/[id]/consult">) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  // 前の URL（?thread= と ?start=）は、新しい形に移す
  if (typeof sp.thread === "string" && isUuid(sp.thread)) redirect(`/projects/${id}/consult/${sp.thread}`);
  if (isConsultTopic(sp.start)) redirect(`/projects/${id}/consult/new?start=${sp.start}`);
  const [project, threads] = await Promise.all([getProject(id), aiConfigured() ? listConsultThreads(id) : []]);
  if (!project) notFound();

  if (!aiConfigured()) {
    return (
      <div className="flex flex-col items-start gap-4">
        <PageHeader title="AI と相談" />
        <p className="text-base text-muted">AI との相談は準備中です。ロードマップは手で決められます。</p>
        <ButtonLink href={`/projects/${id}/roadmap`} variant="secondary">
          ロードマップへ
        </ButtonLink>
      </div>
    );
  }

  const base = `/projects/${id}/consult`;

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title="AI と相談"
        sub={`これまでの相談 ${threads.length} 件`}
        help="運用の悩みを相談できます。AI はアカウント設計・最近の投稿・数字・ロードマップを見たうえで、案を 2〜3 個出します。選んだ案だけが、設計やロードマップに入ります。"
        actions={<ButtonLink href={`${base}/new`}>自由に書いて相談する</ButtonLink>}
      />
      {sp.done === "thread_deleted" && <SuccessBanner>会話を削除しました。採用した案（設計・ロードマップ・下書き）は残っています。</SuccessBanner>}

      <Columns
        main={
            <Card className="overflow-hidden">
              <CardHeader title="これまでの相談" />
              {threads.length === 0 ? (
                <p className="px-6 pb-5 text-[15px] text-muted max-sm:px-4">まだありません。</p>
              ) : (
                <ul className="flex flex-col pb-2">
                  {threads.map((t) => (
                    <li key={t.id} className="border-t border-line first:border-t-0">
                      <Link href={`${base}/${t.id}`} className="flex items-center gap-3 px-6 py-3.5 text-[15px] hover:bg-surface2 hover:no-underline max-sm:flex-col max-sm:items-start max-sm:gap-1 max-sm:px-4">
                        <span className="min-w-0 flex-1 truncate font-semibold text-fg max-sm:whitespace-normal">
                          {t.topicTitle ?? t.title}
                          {t.topicTitle && t.title && <span className="font-normal text-muted"> — {t.title}</span>}
                        </span>
                        <span className="num flex shrink-0 items-center gap-3 text-[13px] text-faint">
                          {t.adopted > 0 && <Badge tone="success">採用した案 {t.adopted}</Badge>}
                          <span>{formatShort(t.updatedAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
        }
        side={
            <Card>
              <CardHeader title="新しい相談" />
              <div className="flex flex-wrap gap-2 px-6 pt-1 pb-5 max-sm:px-4">
                {listedConsultTopics().map((t) => (
                  <Link key={t} href={`${base}/new?start=${t}`} className={chipClass({ className: "h-auto min-h-10 px-4 py-1.5 text-[15px] text-fg hover:no-underline max-sm:whitespace-normal" })}>
                    {CONSULT_TOPIC_META[t].button}
                  </Link>
                ))}
              </div>
            </Card>
        }
        sideFirst
      />
    </div>
  );
}
