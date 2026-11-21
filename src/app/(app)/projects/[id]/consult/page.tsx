import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AiQuotaBand } from "@/components/ai/ai-quota-band";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, chipClass } from "@/components/ui/chip";
import { Columns } from "@/components/ui/columns";
import { ConsultClosedBanner } from "@/components/ai/consult-closed-banner";
import { SuccessBanner } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { aiConfigured } from "@/lib/ai/anthropic";
import { getAiBudgetState } from "@/lib/ai/budget-status";
import { aiBlockedText } from "@/lib/ai/budget-status-text";
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
  // AI の枠を使い切っているときは、帯で知らせ、新しい相談を始められない形にする（これまでの相談は読める。2026-11-21 オーナーの依頼）
  const quota = await getAiBudgetState();
  const blocked = quota !== null && aiBlockedText(quota) !== null;

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title="AI と相談"
        sub={`これまでの相談 ${threads.length} 件`}
        help="運用の悩みを相談できます。AI は、アカウントの方針・最近の投稿と数字・目標と週ごとのやることを見ます。そのうえで、案を 2〜3 個出します。選んだ案だけを、アカウントの方針や、目標と週ごとのやることに書き足します。"
        actions={
          blocked ? (
            <Button type="button" disabled>
              自由に書いて相談する
            </Button>
          ) : (
            <ButtonLink href={`${base}/new`}>自由に書いて相談する</ButtonLink>
          )
        }
      />
      <AiQuotaBand state={quota} />
      <ConsultClosedBanner projectId={id} done={sp.done} items={sp.items} reviewed={sp.reviewed} />
      {sp.done === "thread_deleted" && <SuccessBanner>相談を削除しました。採用した案は残っています。アカウントの方針・目標と週ごとのやること・投稿の下書きです。</SuccessBanner>}

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
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate font-semibold text-fg max-sm:whitespace-normal">
                            {t.topicTitle ?? t.title}
                            {t.topicTitle && t.title && <span className="font-normal text-muted"> — {t.title}</span>}
                          </span>
                          {/* 済んだ相談: AI が区切ったときのまとめ（1 行） */}
                          {t.closed && t.summary && <span className="truncate text-[13px] text-muted max-sm:whitespace-normal">まとめ: {t.summary}</span>}
                        </span>
                        <span className="num flex shrink-0 items-center gap-3 text-[13px] text-faint">
                          {t.closed && <Badge>完了</Badge>}
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
                {listedConsultTopics().map((t) =>
                  blocked ? (
                    <span key={t} aria-disabled="true" className={chipClass({ className: "h-auto min-h-10 cursor-not-allowed px-4 py-1.5 text-[15px] text-faint opacity-50 max-sm:whitespace-normal" })}>
                      {CONSULT_TOPIC_META[t].button}
                    </span>
                  ) : (
                    <Link key={t} href={`${base}/new?start=${t}`} className={chipClass({ className: "h-auto min-h-10 px-4 py-1.5 text-[15px] text-fg hover:no-underline max-sm:whitespace-normal" })}>
                      {CONSULT_TOPIC_META[t].button}
                    </Link>
                  ),
                )}
              </div>
            </Card>
        }
        sideFirst
      />
    </div>
  );
}
