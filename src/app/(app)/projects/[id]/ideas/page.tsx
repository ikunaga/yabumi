import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IdeaBoard } from "@/components/ideas/idea-board";
import Link from "next/link";
import { chipClass, chipSolidClass } from "@/components/ui/chip";
import { SuccessBanner } from "@/components/ui/feedback";
import { HelpTip } from "@/components/ui/help";
import { Term } from "@/components/ui/term";
import { aiConfigured } from "@/lib/ai/anthropic";
import { IDEA_SNS, MAX_IDEA_SNS, ideaSourcesFor, newsQuestionsFor, pickIdeaSns, type IdeaSource } from "@/lib/ai/post-ideas";
import { guideFor, productTypeOf } from "@/lib/ai/product-guide";
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
  const lastSource = thread?.request.source;
  // ネタ帳の画面でメモを選んできたら（?source=notes&notes=...）、ネタ帳から
  const defaultNoteIds = typeof noteParam === "string" ? noteParam.split(",").filter((n) => notes.some((x) => x.id === n)).slice(0, MAX_NOTES_FOR_IDEAS) : [];
  // 材料の初期値（D34）: ネタ帳から来たらネタ帳 → 前回の材料（いま選べるものだけ。コミットはアプリでつないでいるときだけ）→ 最近のできごと
  const productType = productTypeOf(project.product_type);
  const sources = ideaSourcesFor(productType);
  const defaultSource: IdeaSource =
    source === "notes" || defaultNoteIds.length ? "notes" : lastSource && sources.includes(lastSource) && (lastSource !== "commits" || repoFullName) ? lastSource : "news";
  const noPillars = !plan || plan.plan.pillars.items.every((p) => !p.name.trim());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[26px] font-bold max-sm:text-[22px]">ネタを出す</h1>
        <nav aria-label="投稿のつくり方" className="flex flex-wrap items-center gap-2">
          <Link href={`/projects/${id}/compose`} className={`${chipClass()} hover:no-underline`}>
            自分で書く
          </Link>
          <span aria-current="page" className={chipSolidClass(true)}>
            AI とネタを出す
          </span>
        </nav>
        <HelpTip label="どんなネタが出るか">
          何を投稿すればいいか浮かばないときに、AI がネタと下書きを出します。作っている過程や仕事の裏側、お客さん・使う人の声のような話は、知ってもらう入り口になります。ネタは、宣伝するものの種類と、アカウント設計の <Term k="contentPillar" /> と口調に沿います。
        </HelpTip>
      </div>
      {done === "thread_deleted" && <SuccessBanner>ネタの会話を消しました。下書きにした投稿は残っています。</SuccessBanner>}
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
        newsQuestions={newsQuestionsFor(productType)}
        newsExample={guideFor(productType).newsExample}
        sources={sources}
        notes={notes.map((n) => ({ id: n.id, body: n.body, hasImage: Boolean(n.image), createdAt: n.createdAt }))}
        defaultNoteIds={defaultNoteIds}
        thread={thread}
        noPillars={noPillars}
      />
    </div>
  );
}
