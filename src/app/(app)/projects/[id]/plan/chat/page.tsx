import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanCoachChat } from "@/components/plan/plan-coach-chat";
import { ButtonLink } from "@/components/ui/button";
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
        <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">AI と考える</h1>
        <p className="text-base leading-[1.8] text-muted">AI との相談は準備中です。それまでは、設計の画面で記入例を見ながら手で入力できます。</p>
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">AI と考える</h1>
          <p className="text-[14px] leading-[1.8] text-muted">アカウント設計を、AI と話しながら 1 つずつ決めます。</p>
        </div>
        <Link href={planHref} className="text-[14px] font-semibold text-primary hover:underline">
          決まった中身を見る・手で直す
        </Link>
      </div>
      <PlanCoachChat key={thread?.id ?? "new"} projectId={id} threadId={thread?.id ?? null} messages={thread?.messages ?? []} initialFocus={focus} />
    </div>
  );
}
