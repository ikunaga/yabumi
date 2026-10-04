import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AttentionCard } from "@/components/posts/attention-card";
import { displayStatus } from "@/components/posts/post-chip";
import { NextAction } from "@/components/projects/next-action";
import { SnsAccountsCard } from "@/components/projects/sns-accounts-card";
import { PlanSummaryCard } from "@/components/plan/plan-summary-card";
import { GithubPrompt } from "@/components/github/github-prompt";
import { SuccessBanner } from "@/components/ui/feedback";
import { githubConfigured } from "@/lib/github/config";
import { createClient } from "@/lib/supabase/server";
import { SnsResultBanner } from "@/components/projects/sns-result-banner";
import { StatusMark } from "@/components/ui/marks";
import { listPostsNeedingAttention, listUpcomingPosts, postTitle } from "@/lib/posts/queries";
import { formatShort } from "@/lib/time";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Term } from "@/components/ui/term";
import { currentStepIndex } from "@/lib/projects/next-step";
import { getProject } from "@/lib/projects/queries";
import { listProjectSnsAccounts } from "@/lib/sns/queries";
import { getAccountPlan } from "@/lib/plan/queries";
import { isUuid } from "@/lib/uuid";

export async function generateMetadata(props: PageProps<"/projects/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const project = isUuid(id) ? await getProject(id) : null;
  return { title: project?.name ?? "プロジェクト" };
}

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  const { connected, sns_error, done } = await props.searchParams;
  const project = await getProject(id);
  if (!project) notFound();
  const editHref = `/projects/${project.id}/edit`;
  const supabase = await createClient();
  const [upcoming, snsAccounts, attention, plan, { data: repoLink }] = await Promise.all([
    listUpcomingPosts(project.id),
    listProjectSnsAccounts(project.id),
    listPostsNeedingAttention(project.id),
    getAccountPlan(project.id),
    supabase.from("project_github_repos").select("full_name").eq("project_id", project.id).maybeSingle(),
  ]);
  const showGithubPrompt = !repoLink && !project.github_prompt_dismissed_at;
  const planDone = Boolean(plan && (plan.done || plan.skipped));
  const connectedSnsCount = new Set(snsAccounts.filter((a) => a.status === "active").map((a) => a.sns)).size;

  return (
    <div className="flex flex-col gap-7 max-sm:gap-4">
      <div className="flex items-end justify-between gap-4 max-sm:hidden">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="font-heading text-3xl font-bold">{project.name}</h1>
          {project.description && <p className="text-base text-muted">{project.description}</p>}
        </div>
        <Link href={editHref} className="shrink-0 text-[14px] font-semibold text-primary hover:underline">
          編集
        </Link>
      </div>
      <h1 className="sr-only sm:hidden">{project.name}</h1>

      <SnsResultBanner connected={connected} error={sns_error} />
      {done === "description" && <SuccessBanner>アプリの紹介文（どんなアプリか）を保存しました。アカウント設計の AI にも伝わります。</SuccessBanner>}

      {showGithubPrompt && <GithubPrompt projectId={project.id} configured={githubConfigured()} />}

      <NextAction stepIndex={currentStepIndex({ planDone, connectedSnsCount })} projectId={project.id} />

      <AttentionCard projectId={project.id} posts={attention} />

      <div className="grid grid-cols-2 gap-6 max-lg:grid-cols-1 max-sm:gap-4">
        <Card className="overflow-hidden">
          <CardHeader
            title="これからの投稿"
            action={
              <Link href={`/projects/${project.id}/calendar`} className="hover:underline">
                すべて見る
              </Link>
            }
          />
          {upcoming.length === 0 ? (
            <EmptyState
              description={
                <>
                  まだ予定はありません。
                  <Link href={`/projects/${project.id}/compose`} className="font-semibold text-primary hover:underline">
                    投稿をつくる
                  </Link>
                </>
              }
              className="px-5 py-8 max-sm:px-4 max-sm:py-5"
            />
          ) : (
            <ul>
              {upcoming.map((p) => {
                const status = displayStatus(p);
                return (
                  <li key={p.id} className="border-b border-line last:border-b-0">
                    <Link
                      href={`/projects/${project.id}/posts/${p.id}`}
                      className="grid grid-cols-[90px_1fr_auto] items-center gap-3 px-5 py-3 text-[14px] hover:bg-surface2 hover:no-underline max-sm:px-4"
                    >
                      <span className="text-muted">{p.planned_at ? formatShort(p.planned_at) : ""}</span>
                      <span className="truncate">{postTitle(p.body, 30)}</span>
                      <StatusMark status={status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="このアプリについて"
            action={
              <Link href={editHref} className="hover:underline sm:hidden">
                編集
              </Link>
            }
          />
          <dl className="grid grid-cols-[120px_1fr] text-[14px]">
            <AboutRow label={<Term k="persona" />}>
              {project.target_audience || <span className="text-muted">まだ決まっていません</span>}
            </AboutRow>
            <AboutRow label="App Store">
              <StoreValue url={project.app_store_url} editHref={editHref} />
            </AboutRow>
            <AboutRow label="Google Play" last>
              <StoreValue url={project.play_store_url} editHref={editHref} />
            </AboutRow>
          </dl>
        </Card>

        <SnsAccountsCard projectId={project.id} accounts={snsAccounts} />

        {plan && <PlanSummaryCard projectId={project.id} plan={plan.plan} />}
      </div>
    </div>
  );
}

function AboutRow({ label, children, last }: { label: React.ReactNode; children: React.ReactNode; last?: boolean }) {
  const border = last ? "" : "border-b border-line";
  return (
    <>
      <dt className={`px-5 py-3 text-muted max-sm:px-4 ${border}`}>{label}</dt>
      <dd className={`min-w-0 py-3 pr-5 leading-[1.6] ${border}`}>{children}</dd>
    </>
  );
}

function StoreValue({ url, editHref }: { url: string | null; editHref: string }) {
  if (!url) {
    return (
      <Link href={editHref} className="font-semibold text-primary hover:underline">
        ＋ 追加
      </Link>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-success hover:underline">
      ✓ 登録済み
    </a>
  );
}
