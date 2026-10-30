import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ManualMetricForm } from "@/components/metrics/manual-metric-form";
import { ChartEmpty, DailyBars } from "@/components/overview/daily-chart";
import { Panel, SnsClicks } from "@/components/overview/overview-panels";
import { ButtonLink, NotReadyButton } from "@/components/ui/button";
import { Disclosure, HelpTip } from "@/components/ui/help";
import { Delta } from "@/components/ui/metric";
import { Columns } from "@/components/ui/columns";
import { SnsMark } from "@/components/ui/marks";
import { PageHeader } from "@/components/ui/page-header";
import { tabClass, tabListClass } from "@/components/ui/tabs";
import { Term } from "@/components/ui/term";
import { aiConfigured } from "@/lib/ai/anthropic";
import { loadDailyNumbers } from "@/lib/metrics/daily";
import type { PostMeta } from "@/lib/metrics/post-meta";
import { KPIS, KPI_KEYS, recommendedKpis, type KpiKey } from "@/lib/metrics/kpis";
import { listManualTargets, loadMetricsOverview, snsNeedingInsightsReconnect, xMetricsOverLimit, type WeekValue } from "@/lib/metrics/queries";
import { CHART_DAYS, dailySeries, pctChange, shortDay, type Daily } from "@/lib/overview/numbers";
import { connectedAccounts } from "@/lib/posts/queries";
import { getAccountPlan } from "@/lib/plan/queries";
import { getProject } from "@/lib/projects/queries";
import { projectSettingsHref } from "@/lib/projects/paths";
import { SNS } from "@/lib/sns";
import { xMetricsUserMonthlyUsd } from "@/lib/sns/x/config";
import { createClient } from "@/lib/supabase/server";
import { toYmd } from "@/lib/time";

export const metadata: Metadata = { title: "分析" };

function formatCount(n: number) {
  return n.toLocaleString("ja-JP");
}

// カードが 4 枚に満たないときも、横幅いっぱいに並べる（Tailwind はクラス名をそのまま探すので書き並べる）
const COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" };

// 日ごとの棒グラフで選べる数字
const CHARTS = {
  posts: { label: "投稿", unit: "本" },
  clicks: { label: "ストアへのクリック", unit: "回" },
  downloads: { label: "ダウンロード", unit: "件" },
  page_views: { label: "ストアのページの閲覧", unit: "回" },
} as const;
type ChartKey = keyof typeof CHARTS;

// 追いかける数字のカード（見本 A の数字のカード）。数字がまだ出せないものは、数字の代わりに出す方法（つなぐ）を出す
function KpiCard({ k, value, projectId }: { k: KpiKey; value?: WeekValue; projectId: string }) {
  const def = KPIS[k];
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
  const delta = pctChange(value.thisWeek, value.lastWeek);
  const period = value.unit ? "直近 28 日" : "直近 7 日";
  const note = delta !== null ? `${period}・${value.unit ? "1 週間前比" : "先週比"}` : value.lastWeek === 0 && value.thisWeek > 0 ? `${period}・先週は 0` : period;
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
  const { chart } = await props.searchParams;
  const project = await getProject(id);
  if (!project) notFound();
  const supabase = await createClient();
  const today = toYmd(new Date());
  const [account, overview, manual, accounts, daily] = await Promise.all([
    getAccountPlan(project.id),
    loadMetricsOverview(project.id),
    listManualTargets(project.id),
    connectedAccounts(project.id),
    loadDailyNumbers(supabase, project.id, today, CHART_DAYS),
  ]);
  const [needReconnect, xOver] = await Promise.all([snsNeedingInsightsReconnect(accounts), xMetricsOverLimit(accounts, xMetricsUserMonthlyUsd())]);
  const plan = account?.plan ?? null;
  const base = `/projects/${project.id}`;

  const chosen = plan?.first_month.kpis ?? [];
  const kpis = chosen.length ? chosen : recommendedKpis(plan?.goal.goalType ?? null);
  const goal = plan?.first_month.goal.trim() ?? "";
  // 閲覧数を自動で読める SNS を 1 つでもつないでいるか（よく見られた投稿の空のときの案内を変える）
  const hasAutoSns = (["threads", "instagram", "facebook", "x"] as const).some((s) => accounts[s]);
  const later = KPI_KEYS.filter((k) => KPIS[k].availability === "later" && !kpis.includes(k));

  // 日ごとの棒: 数字があるものだけ選べる（ダウンロードとページの閲覧はストアから取り込んだことがあるときだけ）
  const series: Partial<Record<ChartKey, Daily[]>> = {
    posts: daily.published,
    clicks: daily.clicks,
    ...(overview.kpiValues.downloads ? { downloads: daily.downloads } : {}),
    ...(overview.kpiValues.store_page_views ? { page_views: daily.pageViews } : {}),
  };
  const chartKeys = Object.keys(series) as ChartKey[];
  const fallback: ChartKey = series.downloads ? "downloads" : "clicks";
  const current: ChartKey = typeof chart === "string" && chart in series ? (chart as ChartKey) : fallback;
  const rows = dailySeries(series[current] ?? [], today, CHART_DAYS);
  const total = rows.reduce((n, r) => n + r.value, 0);

  return (
    <div className="flex flex-col gap-4 max-sm:gap-3">
      <PageHeader
        title="分析"
        help={
          <>
            <p>うまくいっているかを、数字で確かめる画面です。全部を見る必要はありません。上の {kpis.length} つだけ、週に 1 回見れば十分です。</p>
            <p className="mt-2">追いかける数字（KPI）は、アカウント設計の「最初の 1 か月」で選べます。選んでいなければ、目的に合わせたおすすめを出しています。</p>
          </>
        }
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
            <ButtonLink href={`${base}/stores`} variant="secondary" size="sm">
              ストアと課金をつなぐ
            </ButtonLink>
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
          <KpiCard key={k} k={k} value={overview.kpiValues[k]} projectId={project.id} />
        ))}
      </div>

      {/* 2 列（xl から。左に日ごとの数と手で記録、右に SNS ごと・投稿ごとの要点）。docs/design/new_design/README.md の「中身の幅と 2 列」 */}
      <Columns
        main={
          <>
            <Panel title="日ごとの数" aside={`直近 ${CHART_DAYS} 日 / 合計 ${formatCount(total)}`}>
              <nav className={`${tabListClass} mb-4`} aria-label="グラフの数字">
                {chartKeys.map((k) => (
                  <Link key={k} href={`?chart=${k}`} scroll={false} replace aria-current={k === current ? "page" : undefined} className={`${tabClass(k === current)} hover:no-underline`}>
                    {CHARTS[k].label}
                  </Link>
                ))}
              </nav>
              {total > 0 ? (
                <DailyBars rows={rows} label={`${CHARTS[current].label}の日ごとの数（直近 ${CHART_DAYS} 日）`} />
              ) : (
                <ChartEmpty>
                  <p>直近 {CHART_DAYS} 日の{CHARTS[current].label}はまだありません。</p>
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
              {!series.downloads && (
                <p className="mt-3 text-sm text-muted">
                  ダウンロードは、
                  <Link href={`${base}/stores`} className="font-bold text-fg underline">
                    ストアをつなぐ
                  </Link>
                  と並べて見られます。
                </p>
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
        side={
          <>
            <Panel title="SNS ごとのストアへのクリック" aside="30 日">
              {overview.clicksBySns.some((c) => c.last30d > 0) ? (
                <>
                  <SnsClicks rows={overview.clicksBySns.filter((c) => c.last30d > 0)} />
                  <Disclosure summary="先週との比べ" className="mt-4">
                    <table className="num w-full text-sm text-fg">
                      <thead className="text-left text-xs text-muted">
                        <tr>
                          <th className="py-1 font-normal">SNS</th>
                          <th className="py-1 text-right font-normal">直近 7 日</th>
                          <th className="py-1 text-right font-normal">その前の 7 日</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.clicksBySns.map((c) => (
                          <tr key={c.label} className="border-t border-line">
                            <td className="py-1.5">{c.label}</td>
                            <td className="py-1.5 text-right font-bold">{formatCount(c.thisWeek)}</td>
                            <td className="py-1.5 text-right text-muted">{formatCount(c.lastWeek)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Disclosure>
                </>
              ) : (
                <p className="text-sm text-muted">
                  SNS ごとの<Term k="shortLink" />を付けて投稿すると、どの SNS からストアへ来たかが並びます。
                  <Link href={`${base}/links`} className="ml-1 font-bold text-fg underline">
                    短縮リンクを作る
                  </Link>
                </p>
              )}
            </Panel>
            <Panel title="よく見られた投稿" aside="30 日">
              {overview.topViewed.length ? (
                <Ranked projectId={project.id} rows={overview.topViewed.map((p) => ({ ...p, value: `${formatCount(p.views)} 回表示` }))} />
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
                <Ranked projectId={project.id} rows={overview.topPosts.map((p) => ({ ...p, value: `${formatCount(p.clicks)} クリック` }))} />
              ) : (
                <p className="text-sm text-muted">投稿の本文のストアの URL を短縮リンクにして送ると、どの投稿からクリックされたかが並びます。</p>
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
function Ranked({ projectId, rows }: { projectId: string; rows: (PostMeta & { postId: string; value: string })[] }) {
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
            <span className="num shrink-0 text-muted">{r.value}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
