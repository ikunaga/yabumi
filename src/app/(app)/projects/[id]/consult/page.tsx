import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { SuccessBanner } from "@/components/ui/feedback";
import { aiConfigured } from "@/lib/ai/anthropic";
import { isConsultTopic } from "@/lib/ai/consult";
import { listConsultThreads } from "@/lib/ai/consult-queries";
import { CONSULT_TOPIC_META, type ConsultTopicKey } from "@/lib/ai/consult-topics";
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
  const project = await getProject(id);
  if (!project) notFound();

  if (!aiConfigured()) {
    return (
      <div className="flex max-w-[640px] flex-col items-start gap-4">
        <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">AI と相談</h1>
        <p className="text-base leading-[1.8] text-muted">AI との相談は準備中です。ロードマップは、手で目標とやることを決められます。</p>
        <ButtonLink href={`/projects/${id}/roadmap`} variant="secondary">
          ロードマップへ
        </ButtonLink>
      </div>
    );
  }

  const threads = await listConsultThreads(id);
  const base = `/projects/${id}/consult`;

  return (
    <div className="flex max-w-[880px] flex-col gap-6 max-sm:gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">AI と相談</h1>
        <p className="text-[14px] leading-[1.8] text-muted">
          運用の悩みを相談できます。AI はアカウント設計・最近の投稿・数字・ロードマップを見たうえで、案を 2〜3 個出します。選んだ案だけが、設計やロードマップに入ります。
        </p>
      </div>
      {sp.done === "thread_deleted" && <SuccessBanner>会話を削除しました。採用した案（設計・ロードマップ・下書き）は残っています。</SuccessBanner>}

      <section aria-labelledby="new-consult" className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4">
        <h2 id="new-consult" className="font-bold">
          新しい相談
        </h2>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CONSULT_TOPIC_META) as ConsultTopicKey[]).map((t) => (
            <Link
              key={t}
              href={`${base}/new?start=${t}`}
              className="rounded-full border border-primary px-3.5 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft hover:no-underline"
            >
              {CONSULT_TOPIC_META[t].button}
            </Link>
          ))}
        </div>
        <Link href={`${base}/new`} className="self-start text-sm font-semibold text-primary hover:underline">
          自由に書いて相談する →
        </Link>
      </section>

      <section aria-labelledby="past-threads" className="flex flex-col gap-2">
        <h2 id="past-threads" className="font-bold">
          これまでの相談
        </h2>
        {threads.length === 0 ? (
          <p className="text-sm text-muted">まだありません。上の「新しい相談」から始めると、ここに並びます。</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-border bg-surface">
            {threads.map((t) => (
              <li key={t.id}>
                <Link href={`${base}/${t.id}`} className="flex items-center gap-3 px-4 py-3 text-[14px] hover:bg-surface2 hover:no-underline max-sm:flex-col max-sm:items-start max-sm:gap-1">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="min-w-0 truncate font-semibold text-fg max-sm:whitespace-normal">
                      {t.topicTitle ?? t.title}
                      {t.topicTitle && t.title && <span className="font-normal text-muted"> — {t.title}</span>}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs text-muted">
                    {t.adopted > 0 && <span>採用した案 {t.adopted}</span>}
                    <span>{formatShort(t.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
