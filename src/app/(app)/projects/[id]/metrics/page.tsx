import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ManualMetricForm } from "@/components/metrics/manual-metric-form";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Term } from "@/components/ui/term";
import { aiConfigured } from "@/lib/ai/anthropic";
import { KPIS, KPI_KEYS, recommendedKpis, type KpiKey } from "@/lib/metrics/kpis";
import { listManualTargets, loadMetricsOverview, snsNeedingInsightsReconnect, xMetricsOverLimit, type WeekValue } from "@/lib/metrics/queries";
import { connectedAccounts } from "@/lib/posts/queries";
import { getAccountPlan } from "@/lib/plan/queries";
import { getProject } from "@/lib/projects/queries";
import { SNS } from "@/lib/sns";
import { xMetricsUserMonthlyUsd } from "@/lib/sns/x/config";

export const metadata: Metadata = { title: "指標" };

function formatCount(n: number) {
  return n.toLocaleString("ja-JP");
}

// 先週と比べた一文。素人が「増えた・減った」をすぐ読めるように
function compare(v: WeekValue): string {
  if (v.thisWeek === 0 && v.lastWeek === 0) return "まだ数字がありません";
  if (v.lastWeek === 0) return "先週は 0 でした";
  const diff = v.thisWeek - v.lastWeek;
  if (diff === 0) return v.unit ? "1 週間前と同じ" : "先週と同じ";
  const amount = v.unit === "JPY" ? `¥${formatCount(Math.round(Math.abs(diff)))}` : formatCount(Math.abs(diff));
  return `${v.unit ? "1 週間前" : "先週"}より ${amount} ${diff > 0 ? "増えました" : "減りました"}`;
}

function KpiCard({ k, value, projectId }: { k: KpiKey; value?: WeekValue; projectId: string }) {
  const def = KPIS[k];
  const label = def.term ? <Term k={def.term}>{def.label}</Term> : def.label;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-bold">{label}</p>
      {def.availability === "later" || !value ? (
        <>
          <p className="text-2xl font-bold text-muted">—</p>
          {def.availability === "connect" ? (
            <p className="text-xs leading-[1.7]">
              <Link href={def.connectTo === "sns" ? `/projects/${projectId}#sns` : `/projects/${projectId}/stores`} className="font-semibold text-primary hover:underline">
                {def.howToGet}
              </Link>
            </p>
          ) : (
            <p className="text-xs leading-[1.7] text-muted">準備中: {def.howToGet}</p>
          )}
        </>
      ) : (
        <>
          <p className="text-3xl font-bold">
            {value.unit === "JPY" ? `¥${formatCount(Math.round(value.thisWeek))}` : formatCount(value.thisWeek)}
            <span className="ml-1 text-sm font-normal text-muted">{value.unit ? "直近 28 日" : "直近 7 日"}</span>
          </p>
          <p className="text-sm">{compare(value)}</p>
          {def.availability === "partial" && <p className="text-xs leading-[1.7] text-muted">{def.howToGet}</p>}
        </>
      )}
      <p className="text-xs leading-[1.7] text-muted">{def.meaning}</p>
    </div>
  );
}

// 指標（F07。docs/architecture.md の 4.22）。アカウント設計の「最初の 1 か月」で選んだ数字を先頭に出す
export default async function MetricsPage(props: PageProps<"/projects/[id]/metrics">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const [account, overview, manual, accounts] = await Promise.all([
    getAccountPlan(project.id),
    loadMetricsOverview(project.id),
    listManualTargets(project.id),
    connectedAccounts(project.id),
  ]);
  const [needReconnect, xOver] = await Promise.all([snsNeedingInsightsReconnect(accounts), xMetricsOverLimit(accounts, xMetricsUserMonthlyUsd())]);
  const plan = account?.plan ?? null;

  const chosen = plan?.first_month.kpis ?? [];
  const kpis = chosen.length ? chosen : recommendedKpis(plan?.goal.goalType ?? null);
  const goal = plan?.first_month.goal.trim() ?? "";
  const later = KPI_KEYS.filter((k) => KPIS[k].availability === "later" && !kpis.includes(k));

  return (
    <div className="flex max-w-[960px] flex-col gap-6 max-sm:gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">指標</h1>
        <p className="text-base leading-[1.8] text-muted max-sm:text-[14px]">
          うまくいっているかを、数字で確かめます。全部を見る必要はありません。まずは上の {kpis.length} つだけ、週に 1 回見れば十分です。
        </p>
        <p className="text-sm">
          <Link href={`/projects/${project.id}/stores`} className="font-semibold text-primary hover:underline">
            ストアと課金をつなぐ（ダウンロードと売上）
          </Link>
          <span className="mx-2 text-muted">・</span>
          <Link href={`/projects/${project.id}/links`} className="font-semibold text-primary hover:underline">
            短縮リンク
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader
          title="最初の 1 か月の目標"
          action={
            <Link href={`/projects/${project.id}/plan`} className="hover:underline">
              設計で直す
            </Link>
          }
        />
        <div className="flex flex-col gap-4 px-5 py-4 max-sm:px-4">
          <p className="leading-[1.8]">{goal || <span className="text-muted">まだ決めていません。アカウント設計の「最初の 1 か月」で、AI と一緒に決められます。</span>}</p>
          {!chosen.length && (
            <p className="text-xs leading-[1.7] text-muted">
              追う数字（<Term k="kpi" />）をまだ選んでいないので、目的に合わせたおすすめを出しています。
            </p>
          )}
          <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {kpis.map((k) => (
              <KpiCard key={k} k={k} value={overview.kpiValues[k]} projectId={project.id} />
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 max-sm:px-4">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-bold">AI と振り返る</p>
            <p className="text-sm leading-[1.7] text-muted">
              ここの数字とロードマップを AI が読み、よかった点と次の一手を出します。押したときだけ動きます（週に 1 回くらいがおすすめ）。
            </p>
          </div>
          {aiConfigured() ? (
            <ButtonLink href={`/projects/${project.id}/consult?start=review`}>AI と振り返る</ButtonLink>
          ) : (
            <Button disabled>準備中</Button>
          )}
        </div>
      </Card>

      {needReconnect.length > 0 && (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm leading-[1.7]">
          <span className="mr-1.5 font-bold text-signal">● 要確認</span>
          {needReconnect.map((s) => SNS[s].label).join("・")} の閲覧数やフォロワーを見るには、数字を読む権限を足すためのつなぎ直しが要ります。
          <Link href={`/projects/${project.id}#sns`} className="ml-1 font-semibold text-primary hover:underline">
            つないだ SNS へ
          </Link>
        </p>
      )}

      {xOver && (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm leading-[1.7]">
          <span className="mr-1.5 font-bold text-signal">● 要確認</span>
          今月は X の数字の上限に達しました。X は数字を読むたびに費用がかかるため、1 人あたりの上限を決めています。来月 1 日からまた読みます（それまでの X の数字は増えません）。
        </p>
      )}

      <Card>
        <CardHeader title="よく見られた投稿（30 日）" />
        {overview.topViewed.length ? (
          <ol>
            {overview.topViewed.map((p, i) => (
              <li key={p.postId} className="flex items-center gap-3 border-b border-line px-5 py-2.5 text-sm last:border-b-0 max-sm:px-4">
                <span className="font-bold text-primary">{i + 1}</span>
                <Link href={`/projects/${project.id}/posts/${p.postId}`} className="min-w-0 flex-1 truncate hover:underline">
                  {p.title}
                </Link>
                <span>{formatCount(p.views)} 回表示</span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState description="Threads・Instagram・Facebook を数字の権限つきでつなぐと、送ってから 1・3・7・30 日目の閲覧数を取り込み、よく見られた投稿をここに並べます。" />
        )}
      </Card>

      <Card>
        <CardHeader
          title="SNS ごとのストアへのクリック"
          action={
            <Link href={`/projects/${project.id}/links`} className="hover:underline">
              リンクを作る
            </Link>
          }
        />
        {overview.clicksBySns.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2 font-normal max-sm:px-4">SNS</th>
                <th className="px-3 py-2 text-right font-normal">直近 7 日</th>
                <th className="px-3 py-2 text-right font-normal">その前の 7 日</th>
                <th className="px-5 py-2 text-right font-normal max-sm:px-4">30 日</th>
              </tr>
            </thead>
            <tbody>
              {overview.clicksBySns.map((c) => (
                <tr key={c.label} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-2.5 font-bold max-sm:px-4">{c.label}</td>
                  <td className="px-3 py-2.5 text-right">{formatCount(c.thisWeek)}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{formatCount(c.lastWeek)}</td>
                  <td className="px-5 py-2.5 text-right max-sm:px-4">{formatCount(c.last30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState description="まだクリックがありません。「リンク」で SNS ごとの短縮リンクを作り、プロフィールや投稿に置くと、ここに数字が出ます。" />
        )}
      </Card>

      <Card>
        <CardHeader title="クリックの多い投稿（30 日）" />
        {overview.topPosts.length ? (
          <ol>
            {overview.topPosts.map((p, i) => (
              <li key={p.postId} className="flex items-center gap-3 border-b border-line px-5 py-2.5 text-sm last:border-b-0 max-sm:px-4">
                <span className="font-bold text-primary">{i + 1}</span>
                <Link href={`/projects/${project.id}/posts/${p.postId}`} className="min-w-0 flex-1 truncate hover:underline">
                  {p.title}
                </Link>
                <span>{formatCount(p.clicks)} クリック</span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState description="投稿の本文のストアの URL を短縮リンクにして送ると、どの投稿からクリックされたかがここに並びます。" />
        )}
      </Card>

      <Card>
        <CardHeader title="note・Substack の数字（手で記録）" />
        <p className="border-b border-line px-5 py-3 text-xs leading-[1.7] text-muted max-sm:px-4">
          note と Substack は数字を自動で読めないので、それぞれの画面で見た数字を入れてください（投稿して数日たってからが目安）。入れた閲覧数は、上の「投稿の閲覧数」に足されます。
        </p>
        {manual.length ? (
          <ul>
            {manual.map((m) => (
              <li key={m.targetId} className="flex flex-col gap-2 border-b border-line px-5 py-3 last:border-b-0 max-sm:px-4">
                <div className="flex flex-wrap items-center gap-x-3 text-sm">
                  <b>{SNS[m.sns].label}</b>
                  <Link href={`/projects/${project.id}/posts/${m.postId}`} className="min-w-0 truncate hover:underline">
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
          <EmptyState description="直近 60 日に、note・Substack に投稿した記録がありません。" />
        )}
      </Card>

      {later.length > 0 && (
        <Card>
          <CardHeader title="これから出る数字" />
          <ul className="px-5 py-3 text-sm leading-[1.8] max-sm:px-4">
            {later.map((k) => (
              <li key={k}>
                <b>{KPIS[k].label}</b>
                <span className="ml-2 text-muted">{KPIS[k].howToGet}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
