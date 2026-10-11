import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IdeaBoard } from "@/components/ideas/idea-board";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Term } from "@/components/ui/term";
import { aiConfigured } from "@/lib/ai/anthropic";
import { IDEA_SNS, MAX_IDEA_SNS, pickIdeaSns } from "@/lib/ai/post-ideas";
import { getLatestIdeasThread } from "@/lib/ai/post-ideas-queries";
import { DEFAULT_IDEA_PERIOD, isValidPeriod } from "@/lib/github/commit-reader";
import { githubConfigured } from "@/lib/github/config";
import { getAccountPlan } from "@/lib/plan/queries";
import { connectedAccounts } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import type { SnsKey } from "@/lib/sns";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "最近の開発からネタを出す" };

// 最近のコミットから、AI が投稿のネタを出す（要求 F04 の一部。docs/architecture.md の 4.15）
export default async function IdeasPage(props: PageProps<"/projects/[id]/ideas">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const supabase = await createClient();
  const [{ data: link }, plan, accounts, thread] = await Promise.all([
    supabase.from("project_github_repos").select("full_name").eq("project_id", id).maybeSingle(),
    getAccountPlan(id),
    connectedAccounts(id),
    getLatestIdeasThread(id),
  ]);

  const intro = (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">最近の開発からネタを出す</h1>
      <p className="text-base leading-[1.8] text-muted max-sm:text-[14px]">
        GitHub に記録した最近の変更（コミット）を AI が読み、投稿のネタと下書きを出します。「何に詰まって、どう直したか」「なぜそう作ったか」のような開発の話は、アプリを知ってもらう入り口になります。こうした発信を <Term k="buildInPublic" /> と呼びます。ネタは、アカウント設計の
        <Term k="contentPillar" />
        と口調に沿います。
      </p>
    </div>
  );

  if (!githubConfigured() || !link) {
    return (
      <div className="flex max-w-[760px] flex-col gap-5">
        {intro}
        <Card className="flex flex-col gap-3 px-5 py-4 text-[14px] leading-[1.8] max-sm:px-4">
          <p className="font-bold">まず GitHub のリポジトリをつなぎましょう</p>
          <p className="text-muted">ネタは、つないだリポジトリのコミットから作ります。リポジトリは読むだけで、書き込みはしません。非公開のリポジトリも読めます。</p>
          {githubConfigured() ? (
            <div>
              <Link href={`/projects/${id}/github`} className={buttonClass()}>
                GitHub をつなぐ
              </Link>
            </div>
          ) : (
            <p className="flex items-center gap-3">
              <span className={buttonClass({ className: "pointer-events-none opacity-40" })} aria-disabled>
                GitHub をつなぐ
              </span>
              <span className="text-xs text-muted">準備中</span>
            </p>
          )}
        </Card>
      </div>
    );
  }

  // 選ぶ SNS の初期値: 前回選んだもの → つないでいる SNS と、設計で役割を決めた SNS → X と Threads
  const fromPlan = plan ? (Object.keys(plan.plan.cadence.roles) as SnsKey[]).filter((k) => plan.plan.cadence.roles[k]?.trim()) : [];
  const preferred = thread ? pickIdeaSns(thread.request.sns) : pickIdeaSns([...Object.keys(accounts), ...fromPlan]);
  const defaultSns = preferred.length ? preferred : pickIdeaSns(["x", "threads"]);
  const defaultDays = thread && isValidPeriod(thread.request.days) ? thread.request.days : DEFAULT_IDEA_PERIOD;
  const noPillars = !plan || plan.plan.pillars.items.every((p) => !p.name.trim());

  return (
    <div className="flex max-w-[860px] flex-col gap-6 max-sm:gap-4">
      {intro}
      <div className="flex flex-col gap-1 text-sm leading-[1.8] text-muted">
        <p>
          読むリポジトリ: <span className="font-bold break-all text-fg">{link.full_name}</span>（
          <Link href={`/projects/${id}/github`} className="text-primary hover:underline">
            変える
          </Link>
          ）。.env や鍵などのファイルは読まず、コミットの中身は矢書に残しません。
        </p>
        {noPillars && (
          <p>
            投稿の柱がまだ決まっていません。
            <Link href={`/projects/${id}/plan`} className="font-semibold text-primary hover:underline">
              アカウント設計
            </Link>
            で決めると、ネタが柱に沿うようになります（決めなくても出せます）。
          </p>
        )}
      </div>
      <IdeaBoard
        projectId={id}
        repoFullName={link.full_name}
        aiEnabled={aiConfigured()}
        snsOptions={IDEA_SNS}
        maxSns={MAX_IDEA_SNS}
        defaultSns={defaultSns}
        defaultDays={defaultDays}
        thread={thread}
      />
    </div>
  );
}
