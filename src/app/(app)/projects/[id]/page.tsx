import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ConsultClosedBanner } from "@/components/ai/consult-closed-banner";
import { notFound } from "next/navigation";
import { ChartEmpty, DailyBars } from "@/components/overview/daily-chart";
import { TodayTermBand } from "@/components/learning/today-term-band";
import { ConceptHintBand } from "@/components/plan/concept-hint-band";
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
import { loadGoals } from "@/lib/goals/load";
import { loadGoalReview } from "@/lib/goals/review";
import { cycleMergedIntoGoal, kpiCardKeys } from "@/lib/goals/view";
import { DEFAULT_BEHIND_WEEKDAY } from "@/lib/coach/pace";
import { githubConfigured } from "@/lib/github/config";
import { chosenKpis, clickLabel } from "@/lib/metrics/kpis";
import type { WeekValue } from "@/lib/metrics/queries";
import { compareLabel, NOT_ARRIVED, periodLabel } from "@/lib/metrics/store-period";
import { isAppProject, isDevProject } from "@/lib/projects/product-types";
import { loadOverviewNumbers } from "@/lib/overview/load";
import { CHART_DAYS, CHART_DAYS_MOBILE, chartWindow, compareDays, latestAside, pctChange, shortDay, type Daily } from "@/lib/overview/numbers";
import { loadTodayTerm } from "@/lib/learning/today";
import { CONCEPT_HINT_COOKIE, parseConceptHintCookie } from "@/lib/plan/concept-hint";
import { getAccountPlan } from "@/lib/plan/queries";
import { isSectionDone } from "@/lib/plan/schema";
import { listDueManualPosts, listOverduePosts, listPostsNeedingAttention, listUpcomingPosts } from "@/lib/posts/queries";
import { currentStepIndex, STEPS } from "@/lib/projects/next-step";
import { getProject } from "@/lib/projects/queries";
import { loadStepStates } from "@/lib/projects/step-state";
import { overdueItems } from "@/lib/roadmap/load";
import { loadRoadmap, thisWeekCounts, thisWeekTodos } from "@/lib/roadmap/queries";
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
  const { done, items, reviewed, goal, attention: attentionParam } = await props.searchParams;
  const supabase = await createClient();
  // 待ち時間を縮めるため、id だけで読めるもの（プロジェクト・アカウント設計・お知らせの設定）は並べて読む
  const [project, plan, { data: prefs }, goals] = await Promise.all([
    getProject(id),
    getAccountPlan(id),
    supabase.from("notification_prefs").select("behind_weekday").maybeSingle(),
    loadGoals(supabase, id),
  ]);
  if (!project) notFound();
  // 数字のカード: いまの目標の KPI（なければアカウント設計の数字・目的からのおすすめ）
  const kpis = kpiCardKeys(goals.active?.kpis ?? [], project.product_type, chosenKpis(plan?.plan.first_month.kpis, plan?.plan.goal.goalType, project.product_type));
  const [numbers, upcoming, snsAccounts, attention, overdue, manualDue, { data: repoLink }, { data: manualChannels }, roadmap, stepStates, coach, goalReview] = await Promise.all([
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
    // 伴走（4.27）: いまの目標の SNS ごとの週の本数とペース、1 か月の区切り（中間の目標）
    loadCoachView(supabase, project.id, { goals, behindWeekday: prefs?.behind_weekday ?? DEFAULT_BEHIND_WEEKDAY }),
    // 目標の振り返り（KGI の期限が来た・届いた）
    loadGoalReview(supabase, goals),
  ]);
  const stepState = stepStates[project.id];
  const stepIndex = currentStepIndex(stepState);
  // 今週のまだのやること（数字で達成したものは済みと同じに数える。帯の先頭・件数・残りの一覧はどれもこれから）
  const todos = thisWeekTodos(roadmap);
  const now = new Date();
  const scheduled = upcoming.filter((p) => displayStatus(p) === "scheduled").slice(0, 3);
  // 今日の用語（4.47）: その人の状況に合う語を、まだ読んでいない語から。読めなくても概要は出す
  const todayTerm = await loadTodayTerm(
    supabase,
    {
      planIncomplete: !stepState.planDone,
      usedShortLink: numbers.hasLinks,
      hasRoadmap: Boolean(goals.active?.goal.metric) || roadmap.items.length > 0,
      connectedInstagram: snsAccounts.some((a) => a.sns === "instagram"),
    },
    roadmap.today,
  ).catch((e) => {
    console.error("[overview] 今日の用語", e instanceof Error ? e.message : e);
    return null;
  });
  const base = `/projects/${project.id}`;
  const conceptHintClosed = parseConceptHintCookie((await cookies()).get(CONCEPT_HINT_COOKIE)?.value).includes(project.id);

  // アプリのときだけストアの入口、アプリと Web のサービスのときだけ GitHub の案内を出す（決定 D34）
  const isApp = isAppProject(project);
  const clicks = clickLabel(project.product_type);
  const chartName = numbers.chart?.kind === "downloads" ? "ダウンロード" : clicks;
  // 遅れて届くダウンロードは、届いている日で終わる期間の棒にする（大きな数字・カードと同じ期間。chartWindow）
  const arrived = numbers.chart?.arrived;
  const win14 = numbers.chart ? chartWindow(numbers.chart.rows, numbers.today, CHART_DAYS, arrived) : null;
  const win7 = numbers.chart ? chartWindow(numbers.chart.rows, numbers.today, CHART_DAYS_MOBILE, arrived) : null;
  const total14 = win14?.rows.reduce((n, r) => n + r.value, 0) ?? 0;

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

      <ConsultClosedBanner projectId={project.id} done={done} items={items} reviewed={reviewed} goal={goal} />
      {done === "description" && <SuccessBanner>紹介文（プロジェクトの説明）を保存しました。アカウント設計の AI にも伝わります。</SuccessBanner>}

      <NowBand
        projectId={project.id}
        stepIndex={stepIndex}
        github={{ show: isDevProject(project) && !repoLink && !project.github_prompt_dismissed_at, configured: githubConfigured() }}
        coach={coach}
        coachReady={stepState.planDone && stepIndex >= STEPS.length}
        todos={todos}
        progress={Object.fromEntries(todos.map((t) => [t.id, itemProgress(t, roadmap.daily)]))}
        doneCount={thisWeekCounts(roadmap).finished}
        aiEnabled={aiConfigured()}
        goalReview={goalReview}
        cycleMerged={cycleMergedIntoGoal(goals.active?.goal ?? null, coach?.cycle?.ended ? coach.cycle.endsOn : null)}
      />

      {/* コンセプトのおすすめ（4.50）: 4 段階が済んで、コンセプトがまだで、この端末で閉じていない人だけ */}
      {stepIndex >= STEPS.length && plan && !isSectionDone("concept", plan.plan.concept) && !conceptHintClosed && <ConceptHintBand projectId={project.id} />}

      {todayTerm && <TodayTermBand projectId={project.id} term={todayTerm} />}

      <AttentionStrip projectId={project.id} open={attentionParam === "open"} failed={attention} overdue={overdue} manualDue={manualDue} overdueTodos={overdueItems(roadmap.items, roadmap.today, roadmap.daily)} />

      {/* スマホ（見本 D の右）: 大きな数字 1 つと 7 日の棒 */}
      <div className="sm:hidden">
        <MobileHero name={chartName} win={win7} arrived={arrived} hero={numbers.hero7} today={numbers.today} source={numbers.chart?.rows ?? null} empty={emptyChart} />
      </div>

      <OverviewCards cards={numbers.cards} mobileHidden={numbers.chart?.kind} draftsHref={`${base}/drafts`} />

      {/* 2 列（xl から。左に日ごとの棒、右に SNS ごとのクリックと次の予約）。docs/design/new_design/README.md の「中身の幅と 2 列」 */}
      <Columns
        main={
          <>
            <Panel
              className="max-sm:hidden"
              title={numbers.chart ? `${chartName}の推移` : "日ごとの数"}
              aside={win14 ? `${win14.until ? "" : `直近 ${CHART_DAYS} 日 / `}合計 ${total14.toLocaleString("ja-JP")} / ${latestAside(win14.rows, arrived)}` : undefined}
            >
              {win14 ? (
                <DailyBars rows={win14.rows} note={win14.note} label={`${chartName}の日ごとの数（${periodLabel(CHART_DAYS, win14.until)}）`} />
              ) : (
                <ChartEmpty>{numbers.chart ? NOT_ARRIVED : emptyChart}</ChartEmpty>
              )}
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

// スマホの大きな数字（見本 D の右の「きょうの DL」）。その日だけだと 0 が多いので、直近 7 日の合計と、その前の 7 日との比べ。
// ダウンロードは数日遅れて届くので、届いている日で終わる 7 日（hero。「10/30 までの 7 日・その前の 7 日比」）。どこからも届いていなければ数を出さない
// グラフも同じ期間（win。届いていない日があれば「10/24〜10/30」の 7 本と「11/3 までの 4 日はまだ届いていません」）
function MobileHero({ name, win, arrived, hero, source, today, empty }: { name: string; win: ReturnType<typeof chartWindow>; arrived?: string | null; hero?: WeekValue; source: Daily[] | null; today: string; empty: React.ReactNode }) {
  if (source && (!win || hero?.notArrived)) {
    return (
      <Panel title={name}>
        <p className="num text-[40px] leading-none font-bold">—</p>
        <p className="mt-2 text-sm text-faint">{NOT_ARRIVED}</p>
      </Panel>
    );
  }
  if (!win || !source) {
    return (
      <Panel title="日ごとの数">
        <ChartEmpty height="h-36">{empty}</ChartEmpty>
      </Panel>
    );
  }
  const { now, before } = compareDays(source, today, CHART_DAYS_MOBILE);
  const v: WeekValue = hero ?? { thisWeek: now, lastWeek: before };
  const delta = v.noPrev || v.notArrived ? null : pctChange(v.thisWeek, v.lastWeek);
  const prefix = v.until ? `${periodLabel(CHART_DAYS_MOBILE, v.until)}・` : "";
  return (
    <Panel title={name} aside={`${win.until ? "" : `直近 ${CHART_DAYS_MOBILE} 日 / `}${latestAside(win.rows, arrived)}`}>
      <p className="num text-[40px] leading-none font-bold">{v.notArrived ? "—" : v.thisWeek.toLocaleString("ja-JP")}</p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-sm text-faint">
        {v.notArrived ? (
          NOT_ARRIVED
        ) : v.noPrev ? (
          `${prefix}前の記録はまだありません`
        ) : delta !== null ? (
          <>
            <Delta value={delta} unit="%" /> {prefix}
            {v.until ? compareLabel(CHART_DAYS_MOBILE, v.until) : "前の 7 日比"}
          </>
        ) : (
          `${prefix}${v.until ? "その" : ""}前の 7 日は 0`
        )}
      </p>
      <div className="mt-3">
        <DailyBars rows={win.rows} note={win.note} height="h-28" label={`${name}の日ごとの数（${periodLabel(CHART_DAYS_MOBILE, win.until)}）`} />
      </div>
    </Panel>
  );
}
