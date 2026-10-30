import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThreadMenu } from "@/components/ai/thread-menu";
import { PlanCoachChat } from "@/components/plan/plan-coach-chat";
import { SuccessBanner } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { aiConfigured } from "@/lib/ai/anthropic";
import { getLatestPlanThread } from "@/lib/ai/plan-coach-queries";
import { isSectionKey } from "@/lib/plan/schema";
import { getProject } from "@/lib/projects/queries";

export const metadata: Metadata = { title: "AI と考える アカウント設計" };

// アカウント設計を AI と話しながら進める（要求 F15、決定 D13）
export default async function PlanChatPage(props: PageProps<"/projects/[id]/plan/chat">) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const planHref = `/projects/${id}/plan`;

  if (!aiConfigured()) {
    return (
      <div className="flex max-w-[640px] flex-col items-start gap-4">
        <PageHeader title="AI と考える" />
        <p className="text-base text-muted">AI との相談は準備中です。設計の画面で手で入力できます。</p>
        <ButtonLink href={planHref} variant="secondary">
          設計の画面へ
        </ButtonLink>
      </div>
    );
  }

  const thread = await getLatestPlanThread(id);
  const focus = typeof sp.section === "string" && isSectionKey(sp.section) ? sp.section : null;

  return (
    <div className="flex max-w-[880px] flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title="AI と考える"
        help="アカウント設計を、AI と話しながら 1 つずつ決めます。AI の案を採用すると、設計の欄に入ります。"
        actions={
          <>
            <ButtonLink href={planHref} variant="secondary" size="sm">
              決まった中身を見る
            </ButtonLink>
            {/* 削除は会話の下に混ざらないように、見出しの横の「…」に（AI と相談と同じ） */}
            {thread && (
              <ThreadMenu
                projectId={id}
                threadId={thread.id}
                backPath={`/projects/${id}/plan/chat`}
                keeps="設計に採用した内容は残ります。会話は、最後のやり取りから 1 年たつと自動で消えます。"
              />
            )}
          </>
        }
      />
      {sp.done === "thread_deleted" && <SuccessBanner>会話を消しました。設計に採用した内容は残っています。</SuccessBanner>}
      <PlanCoachChat key={thread?.id ?? "new"} projectId={id} threadId={thread?.id ?? null} messages={thread?.messages ?? []} initialFocus={focus} />
    </div>
  );
}
