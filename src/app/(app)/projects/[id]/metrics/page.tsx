import type { Metadata } from "next";
import Link from "next/link";
import { ConsultClosedBanner } from "@/components/ai/consult-closed-banner";
import { LearningTip } from "@/components/learning/learning-tip";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ManualMetricForm } from "@/components/metrics/manual-metric-form";
import { ChartEmpty, DailyBars } from "@/components/overview/daily-chart";
import { Panel } from "@/components/overview/overview-panels";
import { ButtonLink, NotReadyButton } from "@/components/ui/button";
import { Disclosure, HelpTip } from "@/components/ui/help";
import { BarRow, Delta } from "@/components/ui/metric";
import { chipSolidClass } from "@/components/ui/chip";
import { Columns } from "@/components/ui/columns";
import { SNS_COLOR, SnsMark } from "@/components/ui/marks";
import { PageHeader } from "@/components/ui/page-header";
import { tabClass, tabListClass } from "@/components/ui/tabs";
import { Term } from "@/components/ui/term";
import { aiConfigured } from "@/lib/ai/anthropic";
import { loadDailyNumbers } from "@/lib/metrics/daily";
import { campaignTotal, sumPlayUtm, utmEnd, type PlayUtmTotals } from "@/lib/metrics/play-utm";
import { compareLabel, NOT_ARRIVED, periodLabel } from "@/lib/metrics/store-period";
import { confirmedUntil, MIN_DAYS, POST_EFFECT_DAYS, postEffect, type PostEffect } from "@/lib/metrics/post-effect";
import type { PostMeta } from "@/lib/metrics/post-meta";
import { chosenKpis, clickLabel, KPIS, KPI_KEYS, type KpiKey } from "@/lib/metrics/kpis";
import { isAppProject, OUTCOME_ACTIONS } from "@/lib/projects/product-types";
import { OutcomesBox } from "@/components/metrics/outcomes-box";
import { listManualTargets, loadMetricsOverview, METRICS_PERIODS, snsNeedingInsightsReconnect, xMetricsOverLimit, type ClicksBySns, type MetricsPeriod, type WeekValue } from "@/lib/metrics/queries";
import { CHART_DAYS, chartWindow, dailySeries, latestAside, pctChange, shortDay, type Daily } from "@/lib/overview/numbers";
import { connectedAccounts } from "@/lib/posts/queries";
import { getAccountPlan } from "@/lib/plan/queries";
import { getProject } from "@/lib/projects/queries";
import { projectSettingsHref } from "@/lib/projects/paths";
import { SNS, type SnsKey } from "@/lib/sns";
import { xMetricsUserMonthlyUsd } from "@/lib/sns/x/config";
import { createClient } from "@/lib/supabase/server";
import { addDays, toYmd } from "@/lib/time";

export const metadata: Metadata = { title: "分析" };

function formatCount(n: number) {
  return n.toLocaleString("ja-JP");
}

// 期間の比べの名前（「先週比」「前の 30 日比」）
function periodCompare(days: MetricsPeriod) {
  return days === 7 ? "先週比" : "前の 30 日比";
}

// カードが 4 枚に満たないときも、横幅いっぱいに並べる（Tailwind はクラス名をそのまま探すので書き並べる）
const COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" };

// 日ごとの棒グラフで選べる数字
const CHARTS = {
  posts: { label: "投稿", unit: "本" },
  clicks: { label: "ストアへのクリック", unit: "回" },
  downloads: { label: "ダウンロード", unit: "件" },
  page_views: { label: "ストアのページの閲覧", unit: "回" },
  outcomes: { label: "成果（手で記録）", unit: "件" },
} as const;
type ChartKey = keyof typeof CHARTS;

// 追いかける数字のカード（見本 A の数字のカード）。数字がまだ出せないものは、数字の代わりに出す方法（つなぐ）を出す
function KpiCard({ k, value, projectId, days, productType }: { k: KpiKey; value?: WeekValue; projectId: string; days: MetricsPeriod; productType: string }) {
  // 行き先へのクリックは、アプリなら「ストアへのクリック」（決定 D34）
  const def = k === "link_clicks" ? { ...KPIS[k], label: clickLabel(productType) } : KPIS[k];
  const label = (
    <span className="inline-flex items-center gap-1.5">
      {def.term ? <Term k={def.term}>{def.label}</Term> : def.label}
      <HelpTip label={`${def.label}の説明`}>
        <p>{def.meaning}</p>
        {def.howToGet && <p className="mt-2 opacity-80">{def.howToGet}</p>}
      </HelpTip>
    </span>
  );
  const frame = (body: ReactNode) => (
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface px-5 py-4 max-sm:px-4 max-sm:py-3">
      {/* Metric と同じ見た目。ラベルの「?」が切れないように、ラベルは省略しない */}
      <div className="text-[14px] text-muted">{label}</div>
      {body}
    </div>
  );
  if (!value) {
    const href = def.connectTo === "sns" ? projectSettingsHref(projectId, "sns") : `/projects/${projectId}/stores`;
    return frame(
      def.availability === "later" ? (
        <p className="mt-3 text-sm text-faint">{def.howToGet}</p>
      ) : (
        <ButtonLink href={href} variant="secondary" size="sm" className="mt-3 self-start">
          {def.connectTo === "sns" ? "SNS をつなぐと出ます" : "ストアや課金をつなぐと出ます"}
        </ButtonLink>
      ),
    );
  }
  const shown = value.unit ? (value.unit === "JPY" ? `¥${formatCount(Math.round(value.thisWeek))}` : `${formatCount(value.thisWeek)} ${value.unit}`) : formatCount(value.thisWeek);
  const delta = value.noPrev ? null : pctChange(value.thisWeek, value.lastWeek);
  // 売上は RevenueCat の 28 日の数字だけなので、期間を切り替えても 28 日のまま
  // ダウンロード・ストアのページの閲覧は、届いている日で終わる期間なら「10/30 までの 7 日・その前の 7 日比」
  const period = value.unit ? "直近 28 日" : periodLabel(days, value.until);
  const before = value.unit ? "1 週間前比" : compareLabel(days, value.until);
  const zeroBefore = value.until ? `その前の ${days} 日` : days === 7 && !value.unit ? "先週" : "前";
  const note = value.noPrev ? `${period}・前の記録はまだありません` : delta !== null ? `${period}・${before}` : value.lastWeek === 0 && value.thisWeek > 0 ? `${period}・${zeroBefore}は 0` : period;
  if (value.notArrived) {
    return frame(
      <>
        <p className="num mt-1.5 text-metric font-bold max-sm:text-[28px]">—</p>
        <p className="mt-1.5 text-[14px] text-faint">{NOT_ARRIVED}</p>
      </>,
    );
  }
  return frame(
    <>
      <p className="num mt-1.5 text-metric font-bold max-sm:text-[28px]">{shown}</p>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[14px] text-faint">
        {delta !== null && <Delta value={delta} unit="%" />}
        <span>{note}</span>
      </p>
    </>,
  );
}

// 分析（F07。docs/architecture.md の 4.22・4.31）。見本 A の作り: 見出し → 追いかける数字のカード → 日ごとの棒と SNS ごとのクリック →
// よく見られた投稿・クリックの多い投稿 → note・Substack の数字。説明は「?」と開く欄に畳む
export default async function MetricsPage(props: PageProps<"/projects/[id]/metrics">) {
  const { id } = await props.params;
  const { chart, days: daysParam, done, items } = await props.searchParams;
  // 期間（数字の段 2）。7 日（既定）か 30 日
  const days: MetricsPeriod = daysParam === "30" ? 30 : 7;
  const chartDays = days === 30 ? 30 : CHART_DAYS;
  const project = await getProject(id);
  if (!project) notFound();
  const supabase = await createClient();
  const today = toYmd(new Date());
  const [account, overview, manual, accounts, daily] = await Promise.all([
    getAccountPlan(project.id),
    loadMetricsOverview(project.id, undefined, days),
    listManualTargets(project.id),
    connectedAccounts(project.id),
    loadDailyNumbers(supabase, project.id, today, POST_EFFECT_DAYS),
  ]);
  const [needReconnect, xOver] = await Promise.all([snsNeedingInsightsReconnect(accounts), xMetricsOverLimit(accounts, xMetricsUserMonthlyUsd())]);
  const plan = account?.plan ?? null;
  const base = `/projects/${project.id}`;
  // アプリのときだけ、ストア・RevenueCat・Google Play・App Store の数字と入口を出す（決定 D34）
  const isApp = isAppProject(project);
  // 成果を手で記録する箱: アプリでないとき、または目標が成果（買う・申し込み・予約・問い合わせ・来店）のとき、または記録があるとき
  const showOutcomes = !isApp || (plan?.goal.goalType != null && (OUTCOME_ACTIONS as readonly string[]).includes(plan.goal.goalType)) || daily.outcomes.length > 0;

  const kpis = chosenKpis(plan?.first_month.kpis, plan?.goal.goalType, project.product_type);
  const goal = plan?.first_month.goal.trim() ?? "";
  // 閲覧数を自動で読める SNS を 1 つでもつないでいるか（よく見られた投稿の空のときの案内を変える）
  const hasAutoSns = (["threads", "instagram", "facebook", "x"] as const).some((s) => accounts[s]);
  const later = KPI_KEYS.filter((k) => KPIS[k].availability === "later" && !kpis.includes(k));

  // Google Play が数えた、yabumi の短縮リンクごとの DL（数字の段 3）。SNS ごとは選んだ期間、投稿ごとは 30 日（投稿の順位と同じ）
  // アプリのときだけ。種類をアプリから変えたプロジェクトは、取り込んだ記録を残したまま出さない（決定 D34。アプリに戻せばまた出る）
  const playConnected = isApp && (daily.stores.includes("google_play") || daily.playUtm.length > 0);
  const appleConnected = isApp && daily.stores.includes("app_store");
  const hasDownloads = isApp && Boolean(overview.kpiValues.downloads);
  // Google Play・Apple の SNS ごとの DL は数日遅れて届くので、届いているいちばん新しい日で終わる期間で数える（「10/30 までの 7 日」）
  const playEnd = utmEnd(daily.playUtm, today) ?? today;
  const playUtm = sumPlayUtm(daily.playUtm, addDays(playEnd, -(days - 1)), playEnd);
  const playUtm30 = sumPlayUtm(daily.playUtm, addDays(playEnd, -29), playEnd);
  const postIds = [...new Set([...overview.topPosts, ...overview.topViewed].map((p) => p.postId))];
  const postCodes = new Map<string, string[]>();
  if ((playConnected || appleConnected) && postIds.length) {
    const { data: links } = await supabase.from("short_links").select("code, post_targets!inner(post_id)").eq("project_id", project.id).eq("kind", "post").in("post_targets.post_id", postIds);
    for (const l of links ?? []) {
      const postId = (l.post_targets as unknown as { post_id: string }).post_id;
      postCodes.set(postId, [...(postCodes.get(postId) ?? []), l.code]);
    }
  }
  const playDlOf = (postId: string) => (playConnected ? campaignTotal(playUtm30.byCampaign, postCodes.get(postId) ?? []) : undefined);
  // Apple が数えた、キャンペーンリンク（ct）ごとのはじめてのダウンロード（数字の段 5）。5 人未満は Apple が省き、少しの乱数が入る
  const appleEnd = utmEnd(daily.appleCampaigns, today) ?? today;
  const apple = sumPlayUtm(daily.appleCampaigns, addDays(appleEnd, -(days - 1)), appleEnd);
  const apple30 = sumPlayUtm(daily.appleCampaigns, addDays(appleEnd, -29), appleEnd);
  const appleDlOf = (postId: string) => (appleConnected ? campaignTotal(apple30.byCampaign, postCodes.get(postId) ?? []) : undefined);
  // 短縮リンクがある SNS（Apple の数がなければ「5 未満」と出す行）
  const linkedSns = overview.clicksBySns.map((c) => c.sns);

  // 前の期間が、数え始める前（短縮リンクを作る前・ストアを取り込み始める前）にかかっていたら、比べない（数える前の日を 0 として比べない）
  const prevStart = addDays(today, -(2 * days - 1));
  const linksPrevKnown = Boolean(daily.linksSince && daily.linksSince <= prevStart);
  // ダウンロード・ストアのページの閲覧は、読み込み（loadStoreTotals）で届いている日で終わる期間にし、比べるかも決めてある
  const withPrevKnown = (k: KpiKey, v: WeekValue | undefined): WeekValue | undefined => {
    if (!v) return v;
    const known = k === "link_clicks" ? linksPrevKnown : true;
    return known ? v : { ...v, noPrev: true };
  };

  // 投稿した日と DL（またはクリック）の関係（数字の段 1）。ダウンロードがあればダウンロード、なければ短縮リンクがあればクリック
  const effectKind: "downloads" | "link_clicks" | null = hasDownloads ? "downloads" : overview.clicksBySns.length ? "link_clicks" : null;
  const effectTo = effectKind ? confirmedUntil(today, effectKind, daily.lastStoreDay) : null;
  // 始めたばかり（始まりが終わりより後）なら、0 日として「あと N 日」を出す。比べる始まりは、直近 60 日と、数え始めた日（ストアを取り込み始めた日・短縮リンクを作った日）の遅いほう。数える前の日を 0 として混ぜない
  const effectFrom = [addDays(today, -(POST_EFFECT_DAYS - 1)), (effectKind === "downloads" ? daily.storeSince : daily.linksSince) ?? today].sort().at(-1)!;
  const effect =
    effectKind && effectTo ? postEffect(daily.published, effectKind === "downloads" ? daily.downloads : daily.clicks, effectFrom, effectTo) : null;

  // 日ごとの棒: 数字があるものだけ選べる（ダウンロードとページの閲覧はストアから取り込んだことがあるときだけ）
  const series: Partial<Record<ChartKey, Daily[]>> = {
    posts: daily.published,
    clicks: daily.clicks,
    ...(daily.outcomes.length ? { outcomes: daily.outcomes } : {}),
    ...(hasDownloads ? { downloads: daily.downloads } : {}),
    ...(isApp && overview.kpiValues.store_page_views ? { page_views: daily.pageViews } : {}),
  };
  const chartKeys = Object.keys(series) as ChartKey[];
  const fallback: ChartKey = series.downloads ? "downloads" : "clicks";
  const current: ChartKey = typeof chart === "string" && chart in series ? (chart as ChartKey) : fallback;
  // 遅れて届く数字の、届いているいちばん新しい日（ほかの数字は undefined）
  const arrived = current === "downloads" ? daily.arrived.downloads : current === "page_views" ? daily.arrived.pageViews : undefined;
  // 棒も届いている日で終わる期間にそろえる（カードの「10/30 までの 7 日」と同じ。まだ届いていない日は棒の下に 1 行で書く）
  const win = chartWindow(series[current] ?? [], today, chartDays, arrived);
  const rows = win?.rows ?? [];
  const total = rows.reduce((n, r) => n + r.value, 0);

  return (
    <div className="flex flex-col gap-4 max-sm:gap-3">
      <PageHeader
        title="分析"
        sub={
          <>
            {goal ? `目標: ${goal}` : "最初の 1 か月の目標は、まだ決めていません"}
            <Link href={`${base}/plan?open=first_month`} className="ml-2 text-muted underline hover:text-fg">
              {goal ? "設計で直す" : "設計で決める"}
            </Link>
          </>
        }
        actions={
          <>
            {/* 期間の切り替え（見本 A の「直近30日」の札）。グラフのタブは残す */}
            <nav aria-label="期間" className="flex gap-1.5">
              {METRICS_PERIODS.map((d) => (
                <Link
                  key={d}
                  href={`?days=${d}${typeof chart === "string" ? `&chart=${chart}` : ""}`}
                  scroll={false}
                  replace
                  aria-current={d === days ? "page" : undefined}
                  className={`${chipSolidClass(d === days)} hover:no-underline`}
                >
                  直近 {d} 日
                </Link>
              ))}
            </nav>
            {isApp && (
              <ButtonLink href={`${base}/stores`} variant="secondary" size="sm">
                ストアと課金をつなぐ
              </ButtonLink>
            )}
            {aiConfigured() ? (
              <ButtonLink href={`${base}/consult/new?start=review`} size="sm">
                AI と振り返る
              </ButtonLink>
            ) : (
              <NotReadyButton size="sm">AI と振り返る</NotReadyButton>
            )}
          </>
        }
      />
      <ConsultClosedBanner done={done} items={items} />
      {/* 分析を開いたときの「ひとこと」（4.47。1 日 1 回まで） */}
      <LearningTip trigger="analytics_opened" />

      {needReconnect.length > 0 && (
        <Notice>
          {needReconnect.map((s) => SNS[s].label).join("・")} の閲覧数やフォロワーを見るには、つなぎ直しが要ります。
          <Link href={projectSettingsHref(project.id, "sns")} className="ml-2 font-bold text-fg underline">
            つないだ SNS へ
          </Link>
          <HelpTip label="つなぎ直しが要る理由" align="right">
            数字を読む権限は、あとから足した権限です。つなぎ直すと、SNS の画面で数字の権限を許可できます。
          </HelpTip>
        </Notice>
      )}
      {xOver && (
        <Notice>
          今月は X の数字の上限に達しました。来月 1 日からまた読みます。
          <HelpTip label="X の上限" align="right">
            X は数字を読むたびに費用がかかるため、1 人あたりの上限を決めています。それまでの X の数字は増えません。
          </HelpTip>
        </Notice>
      )}

      <div className={`grid ${COLS[kpis.length] ?? "grid-cols-3"} gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1 max-sm:gap-3`}>
        {kpis.map((k) => (
          <KpiCard key={k} k={k} value={withPrevKnown(k, overview.kpiValues[k])} projectId={project.id} days={days} productType={project.product_type} />
        ))}
      </div>

      {/* 2 列（xl から。左に日ごとの数・SNS ごとのクリック・ストアが数えた SNS ごとの DL、右に投稿した日との関係・投稿ごとの順位・手で記録。左右の長さが釣り合うように）。docs/design/new_design/README.md の「中身の幅と 2 列」 */}
      <Columns
        main={
          <>
            <Panel title="日ごとの数" aside={win ? `${win.until ? "" : `直近 ${chartDays} 日 / `}合計 ${formatCount(total)} / ${latestAside(rows, arrived)}` : NOT_ARRIVED}>
              <nav className={`${tabListClass} mb-4`} aria-label="グラフの数字">
                {chartKeys.map((k) => (
                  <Link key={k} href={`?chart=${k}${days === 30 ? "&days=30" : ""}`} scroll={false} replace aria-current={k === current ? "page" : undefined} className={`${tabClass(k === current)} hover:no-underline`}>
                    {k === "clicks" ? clickLabel(project.product_type) : CHARTS[k].label}
                  </Link>
                ))}
              </nav>
              {!win ? (
                <ChartEmpty>{NOT_ARRIVED}</ChartEmpty>
              ) : total > 0 ? (
                <DailyBars rows={rows} note={win.note} label={`${current === "clicks" ? clickLabel(project.product_type) : CHARTS[current].label}の日ごとの数（${periodLabel(chartDays, win.until)}）`} />
              ) : (
                <ChartEmpty>
                  <p>{periodLabel(chartDays, win.until)}の{current === "clicks" ? clickLabel(project.product_type) : CHARTS[current].label}はまだありません。</p>
                  {current === "clicks" && (
                    <Link href={`${base}/links`} className="font-bold text-fg underline">
                      短縮リンクを付けて投稿する
                    </Link>
                  )}
                  {current === "posts" && (
                    <Link href={`${base}/compose`} className="font-bold text-fg underline">
                      投稿をつくる
                    </Link>
                  )}
                </ChartEmpty>
              )}
              {isApp && !series.downloads && (
                <p className="mt-3 text-sm text-muted">
                  ダウンロードは、
                  <Link href={`${base}/stores`} className="font-bold text-fg underline">
                    ストアをつなぐ
                  </Link>
                  と並べて見られます。
                </p>
              )}
            </Panel>
            <Panel title={`SNS ごとの${clickLabel(project.product_type)}`} aside={`直近 ${days} 日・${periodCompare(days)}`}>
              {overview.clicksBySns.some((c) => c.thisWeek > 0 || c.lastWeek > 0 || c.last30d > 0) ? (
                <>
                  <SnsClicksCompared rows={overview.clicksBySns} prevKnown={linksPrevKnown} />
                  {days !== 30 && <Disclosure summary="30 日の数" className="mt-4">
                    <table className="num w-full text-sm text-fg">
                      <tbody>
                        {overview.clicksBySns.map((c) => (
                          <tr key={c.label} className="border-t border-line first:border-t-0">
                            <td className="py-1.5">{c.label}</td>
                            <td className="py-1.5 text-right font-bold">{formatCount(c.last30d)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Disclosure>}
                </>
              ) : (
                <p className="text-sm text-muted">
                  SNS ごとの<Term k="shortLink" />を付けて投稿すると、どの SNS から{isApp ? "ストア" : "行き先のページ"}へ来たかが並びます。
                  <Link href={`${base}/links`} className="ml-1 font-bold text-fg underline">
                    短縮リンクを作る
                  </Link>
                </p>
              )}
            </Panel>
            {showOutcomes && (
              <Panel
                title="成果（手で記録）"
                aside={`直近 ${days} 日`}
                help={
                  <HelpTip label="成果を手で記録する理由">
                    買ってもらった・申し込み・予約・問い合わせ・来店の数は、SNS からは読めません。お店の帳簿や予約の画面を見て、日ごとに入れてください。同じ日・同じ種類は上書きされ、0 を入れると消えます。入れていない日は数えません。
                  </HelpTip>
                }
              >
                <OutcomesBox projectId={project.id} rows={daily.outcomes} total={series.outcomes ? dailySeries(series.outcomes, today, days).reduce((n, r) => n + r.value, 0) : 0} goal={plan?.goal.goalType ?? null} today={today} />
              </Panel>
            )}
            {playConnected && (
              <Panel
                title="Google Play が数えた SNS ごとの DL"
                aside={periodLabel(days, playEnd < today ? playEnd : undefined)}
                help={
                  <HelpTip label="Google Play が数えた DL">
                   yabumi の短縮リンクから Google Play のページに来て、はじめてインストールした人の数です（Google Play の「ストアの掲載情報からの獲得」）。App Store の分は入っていません。3〜7 日遅れて届き、あとから直ることがあります。数が少ない流入元は、Google が「その他」にまとめるため、ここには出ません。
                  </HelpTip>
                }
              >
                <PlayDownloadsBox totals={playUtm} unreadable={daily.playUtmUnreadable} />
              </Panel>
            )}
            {appleConnected && (
              <Panel
                title="Apple が数えた SNS ごとの DL"
                aside={periodLabel(days, appleEnd < today ? appleEnd : undefined)}
                help={
                  <HelpTip label="Apple が数えた DL">
                   yabumi の短縮リンク（App Store のキャンペーンリンク）から App Store に来て、はじめてダウンロードした人の数です（App Store Connect の Analytics Reports の App Store Downloads の Detailed）。Google Play の分は入っていません。Apple は 5 人未満の数を省き、少しの乱数を足すので（多くは ±2 ほど）、少しずれます。2 日ほど遅れて届きます。
                  </HelpTip>
                }
              >
                <AppleDownloadsBox totals={apple} unreadable={daily.appleCampaignsUnreadable} requested={daily.appleReports} linkedSns={linkedSns} projectId={project.id} />
              </Panel>
            )}
          </>
        }
        side={
          <>
            <Panel title={effectKind === "downloads" ? "投稿した日とダウンロード" : "投稿した日とクリック"} aside={`直近 ${POST_EFFECT_DAYS} 日`}>
              <PostEffectBox kind={effectKind} effect={effect} projectId={project.id} isApp={isApp} clickName={clickLabel(project.product_type)} />
            </Panel>
            <Panel title="よく見られた投稿" aside="30 日">
              {overview.topViewed.length ? (
                <Ranked projectId={project.id} rows={overview.topViewed.map((p) => ({ ...p, value: `${formatCount(p.views)} 回表示`, playDl: playDlOf(p.postId), appleDl: appleDlOf(p.postId) }))} />
              ) : (
                <p className="text-sm text-muted">
                  Threads・Instagram・Facebook・X を数字の権限つきでつなぐと、送ってから 1・3・7・30 日目の閲覧数を取り込み、ここに並べます。
                  {!hasAutoSns && (
                    <Link href={projectSettingsHref(project.id, "sns")} className="ml-1 font-bold text-fg underline">
                      SNS をつなぐ
                    </Link>
                  )}
                </p>
              )}
            </Panel>
            <Panel title="クリックの多い投稿" aside="30 日">
              {overview.topPosts.length ? (
                <Ranked projectId={project.id} rows={overview.topPosts.map((p) => ({ ...p, value: `${formatCount(p.clicks)} クリック`, playDl: playDlOf(p.postId), appleDl: appleDlOf(p.postId) }))} />
              ) : (
                <p className="text-sm text-muted">投稿の本文の{isApp ? "ストア" : "行き先"}の URL を短縮リンクにして送ると、どの投稿からクリックされたかが並びます。</p>
              )}
            </Panel>
            <Panel
              title="note・Substack の数字"
              help={
                <HelpTip label="手で記録する理由">
                  note と Substack は数字を自動で読めないので、それぞれの画面で見た数字を入れてください（投稿して数日たってからが目安）。
                  {kpis.includes("views") && "入れた閲覧数は、上の「投稿の閲覧数」に足されます。"}
                </HelpTip>
              }
              aside="手で記録"
            >
              {manual.length ? (
                <ul>
                  {manual.map((m) => (
                    <li key={m.targetId} className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 first:pt-0">
                      <div className="flex flex-wrap items-center gap-x-3 text-sm">
                        <b>{SNS[m.sns].label}</b>
                        <Link href={`${base}/posts/${m.postId}`} className="min-w-0 truncate text-fg hover:underline">
                          {m.title}
                        </Link>
                      </div>
                      <ManualMetricForm
                        projectId={project.id}
                        targetId={m.targetId}
                        views={m.views}
                        reactions={m.reactions}
                        viewsLabel={m.sns === "note" ? "ビュー" : "閲覧（Views）"}
                        reactionsLabel={m.sns === "note" ? "スキ" : "いいね（Likes）"}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">直近 60 日に、note・Substack に投稿した記録はありません。</p>
              )}
            </Panel>
          </>
        }
      />

      {later.length > 0 && (
        <Disclosure summary="これから出る数字" className="px-1">
          <ul>
            {later.map((k) => (
              <li key={k}>
                <b className="text-fg">{KPIS[k].label}</b>
                <span className="ml-2">{KPIS[k].howToGet}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

// 「● 要確認」の 1 行
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface px-5 py-3 text-sm max-sm:px-4">
      <b className="text-signal">● 要確認</b>
      {children}
    </div>
  );
}

// 順位つきの投稿の一覧（よく見られた・クリックの多い）。同じ書き出しの投稿を見分けられるように、送った日と SNS の札を添える
function Ranked({ projectId, rows }: { projectId: string; rows: (PostMeta & { postId: string; value: string; playDl?: number; appleDl?: number })[] }) {
  return (
    <ol>
      {rows.map((r, i) => (
        <li key={r.postId} className="border-t border-dashed border-line first:border-t-0">
          <Link href={`/projects/${projectId}/posts/${r.postId}`} className="flex items-center gap-3 py-2 text-[14px] text-fg hover:no-underline hover:opacity-80">
            <span className="num w-4 shrink-0 font-bold text-faint">{i + 1}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate">{r.title}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {r.sentAt && <span className="num">{shortDay(toYmd(new Date(r.sentAt)))}</span>}
                {r.sns.map((s) => (
                  <SnsMark key={s} sns={s} />
                ))}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="num text-muted">{r.value}</span>
              {r.playDl ? <span className="num text-xs text-faint">DL {formatCount(r.playDl)}（Google Play が数えた）</span> : null}
              {r.appleDl ? <span className="num text-xs text-faint">DL {formatCount(r.appleDl)}（Apple が数えた・少しずれます）</span> : null}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

// SNS ごとのストアへのクリック（直近の期間の横棒と、その前の期間と比べた ▲▼）。前が 0 なら % は出さない
function SnsClicksCompared({ rows, prevKnown }: { rows: ClicksBySns[]; prevKnown: boolean }) {
  const shown = [...rows].sort((a, b) => b.thisWeek - a.thisWeek || b.last30d - a.last30d);
  const max = Math.max(1, ...shown.map((r) => r.thisWeek));
  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((r) => {
        const delta = prevKnown ? pctChange(r.thisWeek, r.lastWeek) : null;
        return (
          <div key={r.label} className="grid grid-cols-[6.5rem_1fr_3.5rem_4.5rem] items-center gap-3 text-[15px] max-sm:grid-cols-[4.5rem_1fr_3rem_4rem] max-sm:gap-2 max-sm:text-sm">
            <span className="truncate text-muted">{r.sns ? SNS[r.sns].label : "SNS なし"}</span>
            <span className="h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
              <span className={`block h-full rounded-full ${r.sns ? SNS_COLOR[r.sns].bg : "bg-faint"}`} style={{ width: `${(r.thisWeek / max) * 100}%` }} />
            </span>
            <span className="num text-right font-bold">{formatCount(r.thisWeek)}</span>
            <span className="text-right text-xs">
              {delta !== null ? <Delta value={delta} unit="%" /> : <span className="text-faint">{prevKnown && r.thisWeek > 0 ? "前は 0" : "—"}</span>}
            </span>
          </div>
        );
      })}
      {!prevKnown && <p className="text-xs text-faint">前の期間は短縮リンクを作る前なので、比べていません。</p>}
    </div>
  );
}

// 投稿した日と DL（またはクリック）の 1 日あたりを並べる。どちらも MIN_DAYS 日そろうまでは比べない。相関であって原因ではないと書く
function PostEffectBox({ kind, effect, projectId, isApp, clickName }: { kind: "downloads" | "link_clicks" | null; effect: PostEffect | null; projectId: string; isApp: boolean; clickName: string }) {
  if (!kind || !effect) {
    return isApp ? (
      <p className="text-sm text-muted">
        ストアをつなぐか、短縮リンクを付けて投稿すると、投稿した日としなかった日の数を比べられます。
        <Link href={`/projects/${projectId}/stores`} className="ml-1 font-bold text-fg underline">
          ストアをつなぐ
        </Link>
      </p>
    ) : (
      <p className="text-sm text-muted">
        短縮リンクを付けて投稿すると、投稿した日としなかった日の{clickName}を比べられます。
        <Link href={`/projects/${projectId}/links`} className="ml-1 font-bold text-fg underline">
          短縮リンクを作る
        </Link>
      </p>
    );
  }
  const name = kind === "downloads" ? "ダウンロード" : "クリック";
  const range = `${shortDay(effect.from)}〜${shortDay(effect.to)}`;
  if (!effect.ready) {
    const left = Math.max(0, MIN_DAYS - effect.postedDays) + Math.max(0, MIN_DAYS - effect.quietDays);
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="font-bold">早ければ、あと {left} 日で出ます</p>
        <p className="text-muted">
          「投稿した日とその翌日」と「それ以外の日」が、それぞれ {MIN_DAYS} 日たまると比べます。少ない日数で比べると、偶然の差が大きいためです。
        </p>
        <p className="num text-faint">
          いま: 投稿日と翌日 {effect.postedDays} 日・それ以外の日 {effect.quietDays} 日{effect.from <= effect.to && `（${range}）`}
        </p>
      </div>
    );
  }
  const fmt = (n: number) => (n >= 10 ? Math.round(n).toLocaleString("ja-JP") : n.toLocaleString("ja-JP", { maximumFractionDigits: 1 }));
  const max = Math.max(effect.postedAvg, effect.quietAvg);
  const times = effect.quietAvg > 0 ? effect.postedAvg / effect.quietAvg : null;
  return (
    <div className="flex flex-col gap-3">
      <BarRow label="投稿日と翌日" value={effect.postedAvg} max={max} barClass="bg-info" display={fmt(effect.postedAvg)} />
      <BarRow label="それ以外の日" value={effect.quietAvg} max={max} barClass="bg-faint" display={fmt(effect.quietAvg)} />
      <p className="text-sm">
        {times === null
          ? `投稿日と翌日以外の日の${name}は 0 でした。`
          : times >= 1.05
            ? `投稿日と翌日は、それ以外の日の約 ${times.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} 倍の${name}でした。`
            : times <= 0.95
              ? `投稿日と翌日は、それ以外の日より${name}が少なめでした。`
              : `投稿日と翌日と、それ以外の日で、${name}はほとんど変わりませんでした。`}
        <span className="text-muted">
          （<Term k="correlation">相関</Term>です。投稿のおかげとは限りません）
        </span>
      </p>
      <p className="num text-xs text-faint">
        1 日あたり・{range}（{kind === "downloads" ? "ストアの数字が確定した日まで" : "昨日まで"}）・投稿日と翌日 {effect.postedDays} 日、それ以外の日 {effect.quietDays} 日
      </p>
    </div>
  );
}

// Google Play が数えた、SNS ごとの DL（yabumi の短縮リンクから Google Play のページに来て、はじめてインストールした人）。
// App Store の分は入らない。Google が「その他」にまとめた分は SNS に分けられないので、数だけ添える
function PlayDownloadsBox({ totals, unreadable }: { totals: PlayUtmTotals; unreadable: boolean }) {
  if (unreadable && totals.total === 0) {
    return <p className="text-sm text-muted">Google Play の流入元のレポートを読めませんでした（レポートの形が変わったのかもしれません）。読めるようになるまで、ここには数字を出しません。</p>;
  }
  if (totals.total === 0) {
    return (
      <p className="text-sm text-muted">
        この期間に、yabumi の短縮リンクから Google Play で入れた人は、まだ数えられていません（3〜7 日遅れて届きます。数が少ないと Google が「その他」にまとめます）。
      </p>
    );
  }
  const max = Math.max(1, ...totals.bySns.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2.5">
      {totals.bySns.map((r) => (
        <BarRow key={r.sns ?? "link"} label={r.sns ? SNS[r.sns].label : "SNS なし"} value={r.value} max={max} barClass={r.sns ? SNS_COLOR[r.sns].bg : "bg-faint"} />
      ))}
      <p className="num text-xs text-faint">
        合計 {formatCount(totals.total)}・App Store の分は入っていません{totals.other > 0 && `・「その他」にまとめられた分 ${formatCount(totals.other)}（yabumi のリンク以外も入ります）`}
      </p>
      {unreadable && <p className="text-xs text-signal">一部の月の流入元のレポートを読めませんでした。その月の分は入っていません。</p>}
    </div>
  );
}

// Apple が数えた、SNS ごとのはじめてのダウンロード（キャンペーンリンク）。Apple は 5 人未満の数を省くので、
// 短縮リンクがあるのに数のない SNS は 0 と書かず「5 未満」。数にはいつも「Apple が数えた（少ない数は省かれ、少しずれます）」と添える
function AppleDownloadsBox({
  totals,
  unreadable,
  requested,
  linkedSns,
  projectId,
}: {
  totals: PlayUtmTotals;
  unreadable: boolean;
  requested: boolean;
  linkedSns: (SnsKey | null)[];
  projectId: string;
}) {
  if (!requested) {
    return (
      <p className="text-sm text-muted">
        App Store のページの閲覧数の依頼をすると、Apple が数えた、短縮リンクごとのはじめてのダウンロードも読めます。
        <Link href={`/projects/${projectId}/stores`} className="ml-1 font-bold text-fg underline">
          ストアと課金をつなぐ
        </Link>
      </p>
    );
  }
  if (unreadable && totals.total === 0) {
    return <p className="text-sm text-muted">Apple のダウンロードのレポートを読めませんでした（レポートの形が変わったのかもしれません）。読めるようになるまで、ここには数字を出しません。</p>;
  }
  const shown = new Map<SnsKey | null, number | null>();
  for (const r of totals.bySns) shown.set(r.sns, r.value);
  for (const s of linkedSns) if (!shown.has(s)) shown.set(s, null);
  if (shown.size === 0) {
    return <p className="text-sm text-muted">短縮リンクを付けて投稿すると、ここに Apple が数えた SNS ごとのダウンロードが並びます。</p>;
  }
  const max = Math.max(1, ...totals.bySns.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2.5">
      {[...shown.entries()].map(([sns, value]) =>
        value === null ? (
          <div key={sns ?? "link"} className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-3 text-[15px] max-sm:grid-cols-[5rem_1fr_3.5rem] max-sm:text-sm">
            <span className="truncate text-muted">{sns ? SNS[sns].label : "SNS なし"}</span>
            <span className="h-2 rounded-full bg-subtle" aria-hidden />
            <span className="num text-right text-sm text-faint">5 未満</span>
          </div>
        ) : (
          <BarRow key={sns ?? "link"} label={sns ? SNS[sns].label : "SNS なし"} value={value} max={max} barClass={sns ? SNS_COLOR[sns].bg : "bg-faint"} />
        ),
      )}
      <p className="text-xs text-faint">
        Apple が数えた（少ない数は省かれ、少しずれます）・Google Play の分は入っていません。「5 未満」は、Apple が 5 人未満の数を省いたか、まだ届いていない分です。
      </p>
      {unreadable && <p className="text-xs text-signal">一部の日のダウンロードのレポートを読めませんでした。その日の分は入っていません。</p>}
    </div>
  );
}
