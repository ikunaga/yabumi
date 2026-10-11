import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsultChat } from "@/components/ai/consult-chat";
import { DeleteThreadButton } from "@/components/ai/delete-thread-button";
import { ButtonLink } from "@/components/ui/button";
import { SuccessBanner } from "@/components/ui/feedback";
import { aiConfigured } from "@/lib/ai/anthropic";
import { isConsultTopic } from "@/lib/ai/consult";
import { getConsultThread, listConsultThreads } from "@/lib/ai/consult-queries";
import { getProject } from "@/lib/projects/queries";
import { formatShort } from "@/lib/time";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "AI と相談" };

// AI と相談（F09、docs/architecture.md の 4.23）。?thread= で過去の会話、?start= でよくある相談から始める
export default async function ConsultPage(props: PageProps<"/projects/[id]/consult">) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
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

  const threadParam = typeof sp.thread === "string" && isUuid(sp.thread) ? sp.thread : null;
  const [threads, thread] = await Promise.all([listConsultThreads(id), threadParam ? getConsultThread(id, threadParam) : Promise.resolve(null)]);
  const topic = !thread && isConsultTopic(sp.start) ? sp.start : null;

  return (
    <div className="flex max-w-[880px] flex-col gap-5 max-sm:gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">AI と相談</h1>
          {/* 会話がないときは、下の入口のカードに同じ説明がある */}
          {thread && <p className="text-[14px] leading-[1.8] text-muted">運用の悩みを、アカウント設計・最近の投稿・数字・ロードマップをふまえて相談できます。</p>}
        </div>
        {thread && (
          <Link href={`/projects/${id}/consult`} className="text-[14px] font-semibold text-primary hover:underline">
            新しい相談
          </Link>
        )}
      </div>
      {sp.done === "thread_deleted" && <SuccessBanner>会話を消しました。採用した提案（設計・ロードマップ・下書き）は残っています。</SuccessBanner>}

      <ConsultChat key={thread?.id ?? `new-${topic ?? ""}`} projectId={id} threadId={thread?.id ?? null} messages={thread?.messages ?? []} initialTopic={topic} />

      {thread && (
        <DeleteThreadButton
          projectId={id}
          threadId={thread.id}
          backPath={`/projects/${id}/consult`}
          keeps="採用した提案（設計・ロードマップ・下書き）は残ります。会話は、最後のやり取りから 1 年たつと自動で消えます。"
        />
      )}

      {threads.length > 0 && (
        <section aria-labelledby="past-threads" className="flex flex-col gap-2">
          <h2 id="past-threads" className="text-sm font-bold text-muted">
            これまでの相談
          </h2>
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-border bg-surface">
            {threads.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/projects/${id}/consult?thread=${t.id}`}
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 text-[14px] hover:bg-surface2 ${t.id === thread?.id ? "font-bold text-primary" : ""}`}
                  aria-current={t.id === thread?.id ? "page" : undefined}
                >
                  <span className="min-w-0 truncate">{t.title}</span>
                  <span className="shrink-0 text-xs text-muted">{formatShort(t.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
