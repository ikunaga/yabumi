import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartEmpty, DailyBars } from "@/components/overview/daily-chart";
import { NowBand } from "@/components/overview/now-band";
import { OverviewCards } from "@/components/overview/overview-cards";
import { AttentionStrip, ConnectedSnsLine, NextScheduled, Panel, SnsClicks } from "@/components/overview/overview-panels";
import { displayStatus } from "@/components/posts/post-chip";
import { Columns } from "@/components/ui/columns";
import { SnsMark } from "@/components/ui/marks";
import { Delta } from "@/components/ui/metric";
import { SuccessBanner } from "@/components/ui/feedback";
import { aiConfigured } from "@/lib/ai/anthropic";
import { loadCoachView } from "@/lib/coach/load";
import { DEFAULT_BEHIND_WEEKDAY } from "@/lib/coach/pace";
import { githubConfigured } from "@/lib/github/config";
import { chosenKpis, clickLabel } from "@/lib/metrics/kpis";
import { isAppProject, isDevProject } from "@/lib/projects/product-types";
import { loadOverviewNumbers } from "@/lib/overview/load";
import { CHART_DAYS, CHART_DAYS_MOBILE, compareDays, dailySeries, pctChange, shortDay, type Daily } from "@/lib/overview/numbers";
import { getAccountPlan } from "@/lib/plan/queries";
import { listDueManualPosts, listOverduePosts, listPostsNeedingAttention, listUpcomingPosts } from "@/lib/posts/queries";
import { currentStepIndex, STEPS } from "@/lib/projects/next-step";
import { getProject } from "@/lib/projects/queries";
import { loadStepStates } from "@/lib/projects/step-state";
import { overdueItems } from "@/lib/roadmap/load";
import { loadRoadmap, thisWeekTodos } from "@/lib/roadmap/queries";
import { itemProgress } from "@/lib/roadmap/schema";
import { listProjectSnsAccounts } from "@/lib/sns/queries";
import { createClient } from "@/lib/supabase/server";
import { toYmd } from "@/lib/time";
import { isUuid } from "@/lib/uuid";

export async function generateMetadata(props: PageProps<"/projects/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const project = isUuid(id) ? await getProject(id) : null;
  return { title: project?.name ?? "プロジェクト" };
}

const STORE_NAME = { app_store: "App Store", google_play: "Google Play" } as const;

// 概要（見本 A。決定 D33、2026-10-30 オーナーの決定）。上から: 見出しの行 → つないだ SNS → いまやること（1 行の帯）→ 要確認（あるときだけ）
// → 数字のカード 4 枚 → 左に日ごとの棒グラフ、右に SNS ごとのストアへのクリックと次の予約。数字は直近 30 日と前の 30 日の比べ（docs/architecture.md の 4.31）
export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  const { done } = await props.searchParams;
  const supabase = await createClient();
  // 待ち時間を縮めるため、id だけで読めるもの（プロジェクト・アカウント設計・お知らせの設定）は並べて読む
  const [project, plan, { data: prefs }] = await Promise.all([
    getProject(id),
    getAccountPlan(id),
    supabase.from("notification_prefs").select("behind_weekday").maybeSingle(),
  ]);
  if (!project) notFound();
  const kpis = chosenKpis(plan?.plan.first_month.kpis, plan?.plan.goal.goalType, project.product_type);
  const [numbers, upcoming, snsAccounts, attention, overdue, manualDue, { data: repoLink }, { data: manualChannels }, roadmap, stepStates, coach] = await Promise.all([
    loadOverviewNumbers(project.id, kpis, toYmd(new Date(project.created_at)), project.product_type),
    listUpcomingPosts(project.id, 8),
    listProjectSnsAccounts(project.id),
    listPostsNeedingAttention(project.id),
    listOverduePosts(project.id),
    listDueManualPosts(project.id),
    supabase.from("project_github_repos").select("full_name").eq("project_id", project.id).maybeSingle(),
    supabase.from("project_manual_channels").select("sns").eq("project_id", project.id),
    loadRoadmap(project.id),
    // いまやることの判定（一覧と同じ値。src/lib/projects/step-state.ts）
    loadStepStates([project]),
    // 伴走（4.27）: 最初の 1 か月の SNS ごとの週の回数とペース
    plan ? loadCoachView(supabase, project.id, { firstMonth: plan.plan.first_month, behindWeekday: prefs?.behind_weekday ?? DEFAULT_BEHIND_WEEKDAY }) : null,
  ]);
  const stepState = stepStates[project.id];
  const stepIndex = currentStepIndex(stepState);
  const todos = thisWeekTodos(roadmap);
  const now = new Date();
  const scheduled = upcoming.filter((p) => displayStatus(p) === "scheduled").slice(0, 3);
  const base = `/projects/${project.id}`;

  // アプリのときだけストアの入口、アプリと Web のサービスのときだけ GitHub の案内を出す（決定 D34）
  const isApp = isAppProject(project);
  const clicks = clickLabel(project.product_type);
  const chartName = numbers.chart?.kind === "downloads" ? "ダウンロード" : clicks;
  const chart14 = numbers.chart ? dailySeries(numbers.chart.rows, numbers.today, CHART_DAYS) : null;
  const chart7 = numbers.chart ? dailySeries(numbers.chart.rows, numbers.today, CHART_DAYS_MOBILE) : null;
  const total14 = chart14?.reduce((n, r) => n + r.value, 0) ?? 0;

  const emptyChart = (
    <>
      <p>
        {numbers.hasLinks ? "まだクリックがありません。" : isApp ? "ストアをつなぐか、短縮リンクを付けて投稿すると、日ごとの数がここに並びます。" : "短縮リンクを付けて投稿すると、行き先に来た人の数がここに並びます。"}
      </p>
      <span className="flex flex-wrap justify-center gap-x-4 gap-y-1 font-bold">
        {isApp && (
          <Link href={`${base}/stores`} className="text-fg underline">
            ストアをつなぐ
          </Link>
        )}
        <Link href={`${base}/links`} className="text-fg underline">
          短縮リンクを付けて投稿する
        </Link>
      </span>
    </>
  );

  return (
    <div className="flex flex-col gap-4 max-sm:gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="min-w-0 truncate text-2xl font-bold max-sm:sr-only">{project.name}</h1>
        <div className="flex flex-wrap gap-2 text-[13px] text-muted max-sm:hidden">
          <span className="rounded-full border border-border bg-surface px-3 py-1">直近 30 日</span>
          {numbers.stores.length > 0 && (
            <span className="rounded-full border border-border bg-surface px-3 py-1">{numbers.stores.map((s) => STORE_NAME[s]).join(" + ")}</span>
          )}
        </div>
      </div>

      <ConnectedSnsLine projectId={project.id} accounts={snsAccounts} manualChannels={manualChannels ?? []} />

      {done === "description" && <SuccessBanner>紹介文（プロジェクトの説明）を保存しました。アカウント設計の AI にも伝わります。</SuccessBanner>}

      <NowBand
        projectId={project.id}
        stepIndex={stepIndex}
        github={{ show: isDevProject(project) && !repoLink && !project.github_prompt_dismissed_at, configured: githubConfigured() }}
        coach={coach}
        coachReady={stepState.planDone && stepIndex >= STEPS.length}
        todos={todos}
        progress={Object.fromEntries(todos.map((t) => [t.id, itemProgress(t, roadmap.daily)]))}
        doneCount={roadmap.items.filter((i) => i.weekStart === roadmap.thisWeek && i.status === "done").length}
        aiEnabled={aiConfigured()}
      />

      <AttentionStrip projectId={project.id} failed={attention} overdue={overdue} manualDue={manualDue} overdueTodos={overdueItems(roadmap.items, roadmap.today)} />

      {/* スマホ（見本 D の右）: 大きな数字 1 つと 7 日の棒 */}
      <div className="sm:hidden">
        <MobileHero name={chartName} rows={chart7} today={numbers.today} source={numbers.chart?.rows ?? null} empty={emptyChart} />
      </div>

      <OverviewCards cards={numbers.cards} mobileHidden={numbers.chart?.kind} />

      {/* 2 列（xl から。左に日ごとの棒、右に SNS ごとのクリックと次の予約）。docs/design/new_design/README.md の「中身の幅と 2 列」 */}
      <Columns
        main={
          <>
            <Panel
              className="max-sm:hidden"
              title={numbers.chart ? `${chartName}の推移` : "日ごとの数"}
              aside={chart14 ? `直近 ${CHART_DAYS} 日 / 合計 ${total14.toLocaleString("ja-JP")}` : undefined}
            >
              {chart14 ? <DailyBars rows={chart14} label={`${chartName}の日ごとの数（直近 ${CHART_DAYS} 日）`} /> : <ChartEmpty>{emptyChart}</ChartEmpty>}
            </Panel>
          </>
        }
        side={
          <>
            <Panel
              title={`SNS ごとの${clicks}`}
              aside={numbers.clicksBySns.length ? numbers.clicksBySns.reduce((n, c) => n + c.last30d, 0).toLocaleString("ja-JP") : undefined}
            >
              {numbers.clicksBySns.length ? (
                <SnsClicks rows={numbers.clicksBySns} />
              ) : (
                <p className="text-sm text-muted">
                  {numbers.hasLinks ? "直近 30 日のクリックはまだありません。" : `SNS ごとの短縮リンクを付けて投稿すると、どの SNS から${isApp ? "ストア" : "行き先"}へ来たかが並びます。`}
                  <Link href={`${base}/links`} className="ml-1 font-bold text-fg underline">
                    短縮リンク
                  </Link>
                </p>
              )}
            </Panel>

            {numbers.topPost && (
              <Panel title="いちばんクリックされた投稿" aside="30 日" className="sm:hidden">
                <Link href={`${base}/posts/${numbers.topPost.postId}`} className="block truncate font-bold text-fg">
                  {numbers.topPost.title}
                </Link>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                  {numbers.topPost.sentAt && <span className="num">{shortDay(toYmd(new Date(numbers.topPost.sentAt)))}</span>}
                  {numbers.topPost.sns.map((s) => (
                    <SnsMark key={s} sns={s} />
                  ))}
                  <span className="num ml-auto">{numbers.topPost.clicks.toLocaleString("ja-JP")} クリック</span>
                </p>
              </Panel>
            )}

            <Panel
              title="次の予約"
              aside={
                <Link href={`${base}/calendar`} className="text-faint hover:text-fg">
                  カレンダー
                </Link>
              }
            >
              {scheduled.length ? (
                <NextScheduled projectId={project.id} posts={scheduled} now={now} />
              ) : (
                <p className="text-sm text-muted">
                  予約した投稿はまだありません。
                  <Link href={`${base}/compose`} className="ml-1 font-bold text-fg underline">
                    投稿をつくる
                  </Link>
                </p>
              )}
            </Panel>
          </>
        }
      />
    </div>
  );
}

// スマホの大きな数字（見本 D の右の「きょうの DL」）。その日だけだと 0 が多いので、直近 7 日の合計と、その前の 7 日との比べ
function MobileHero({ name, rows, source, today, empty }: { name: string; rows: Daily[] | null; source: Daily[] | null; today: string; empty: React.ReactNode }) {
  if (!rows || !source) {
    return (
      <Panel title="日ごとの数">
        <ChartEmpty height="h-36">{empty}</ChartEmpty>
      </Panel>
    );
  }
  const { now, before } = compareDays(source, today, CHART_DAYS_MOBILE);
  const delta = pctChange(now, before);
  return (
    <Panel title={name} aside={`直近 ${CHART_DAYS_MOBILE} 日`}>
      <p className="num text-[40px] leading-none font-bold">{now.toLocaleString("ja-JP")}</p>
      <p className="mt-2 flex items-baseline gap-1.5 text-sm text-faint">
        {delta !== null ? (
          <>
            <Delta value={delta} unit="%" /> 前の 7 日比
          </>
        ) : (
          "前の 7 日は 0"
        )}
      </p>
      <div className="mt-3">
        <DailyBars rows={rows} height="h-28" label={`${name}の日ごとの数（直近 ${CHART_DAYS_MOBILE} 日）`} />
      </div>
    </Panel>
  );
}
