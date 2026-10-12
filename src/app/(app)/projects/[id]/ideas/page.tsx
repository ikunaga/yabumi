import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IdeaBoard } from "@/components/ideas/idea-board";
import { SuccessBanner } from "@/components/ui/feedback";
import { Term } from "@/components/ui/term";
import { aiConfigured } from "@/lib/ai/anthropic";
import { IDEA_SNS, MAX_IDEA_SNS, NEWS_QUESTIONS, pickIdeaSns, type IdeaSource } from "@/lib/ai/post-ideas";
import { getLatestIdeasThread } from "@/lib/ai/post-ideas-queries";
import { DEFAULT_IDEA_PERIOD, isValidPeriod } from "@/lib/github/commit-reader";
import { githubConfigured } from "@/lib/github/config";
import { listNotes } from "@/lib/notes/queries";
import { MAX_NOTES_FOR_IDEAS } from "@/lib/notes/rules";
import { getAccountPlan } from "@/lib/plan/queries";
import { connectedAccounts } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import type { SnsKey } from "@/lib/sns";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "投稿のネタを出す" };

// 投稿のネタを AI が出す。材料は最近のコミット・最近のできごと・アカウント設計から選ぶ（要求 F04 の一部。docs/architecture.md の 4.15）
export default async function IdeasPage(props: PageProps<"/projects/[id]/ideas">) {
  const [{ id }, { done, source, notes: noteParam }] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const supabase = await createClient();
  const githubReady = githubConfigured();
  const [{ data: link }, plan, accounts, thread, notes] = await Promise.all([
    supabase.from("project_github_repos").select("full_name").eq("project_id", id).maybeSingle(),
    getAccountPlan(id),
    connectedAccounts(id),
    getLatestIdeasThread(id),
    listNotes(id, { unusedOnly: true }),
  ]);
  const repoFullName = githubReady ? (link?.full_name ?? null) : null;

  // 選ぶ SNS の初期値: 前回選んだもの → つないでいる SNS と、設計で役割を決めた SNS → X と Threads
  const fromPlan = plan ? (Object.keys(plan.plan.cadence.roles) as SnsKey[]).filter((k) => plan.plan.cadence.roles[k]?.trim()) : [];
  const preferred = thread ? pickIdeaSns(thread.request.sns) : pickIdeaSns([...Object.keys(accounts), ...fromPlan]);
  const defaultSns = preferred.length ? preferred : pickIdeaSns(["x", "threads"]);
  const defaultDays = thread?.request.days && isValidPeriod(thread.request.days) ? thread.request.days : DEFAULT_IDEA_PERIOD;
  // 材料の初期値: 前回の材料（コミットはつないでいるときだけ）→ つないでいればコミット、なければ最近のできごと
  const lastSource = thread?.request.source;
  // ネタ帳の画面でメモを選んできたら（?source=notes&notes=...）、ネタ帳から
  const defaultNoteIds = typeof noteParam === "string" ? noteParam.split(",").filter((n) => notes.some((x) => x.id === n)).slice(0, MAX_NOTES_FOR_IDEAS) : [];
  const defaultSource: IdeaSource =
    source === "notes" ? "notes" : lastSource && (lastSource !== "commits" || repoFullName) ? lastSource : repoFullName ? "commits" : "news";
  const noPillars = !plan || plan.plan.pillars.items.every((p) => !p.name.trim());

  return (
    <div className="flex max-w-[960px] flex-col gap-6 max-sm:gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">投稿のネタを出す</h1>
        <p className="text-base leading-[1.8] text-muted max-sm:text-[14px]">
          何を投稿すればいいか浮かばないときに、AI がネタと下書きを出します。材料は、最近の開発（GitHub）、最近のできごと、ネタ帳のメモ、アカウント設計から選べます。「何に詰まって、どう直したか」「なぜそう作ったか」のような作り手の話は、アプリを知ってもらう入り口になります。こうした発信を <Term k="buildInPublic" /> と呼びます。ネタは、アカウント設計の
          <Term k="contentPillar" />
          と口調に沿います。
        </p>
      </div>
      {done === "thread_deleted" && <SuccessBanner>ネタの会話を消しました。下書きにした投稿は残っています。</SuccessBanner>}
      {noPillars && (
        <p className="text-sm leading-[1.8] text-muted">
          投稿の柱がまだ決まっていません。
          <Link href={`/projects/${id}/plan`} className="font-semibold text-primary hover:underline">
            アカウント設計
          </Link>
          で決めると、ネタが柱に沿うようになります（決めなくても出せます）。
        </p>
      )}
      <IdeaBoard
        projectId={id}
        repoFullName={repoFullName}
        githubReady={githubReady}
        aiEnabled={aiConfigured()}
        snsOptions={IDEA_SNS}
        maxSns={MAX_IDEA_SNS}
        defaultSns={defaultSns}
        defaultDays={defaultDays}
        defaultSource={defaultSource}
        newsQuestions={NEWS_QUESTIONS}
        notes={notes.map((n) => ({ id: n.id, body: n.body, hasImage: Boolean(n.image), createdAt: n.createdAt }))}
        defaultNoteIds={defaultNoteIds}
        thread={thread}
      />
    </div>
  );
}
