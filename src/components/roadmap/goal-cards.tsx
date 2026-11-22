import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { DisclosureChevron } from "@/components/ui/disclosure";
import { DismissableDetails } from "@/components/ui/dismissable-details";
import { SNS_COLOR } from "@/components/ui/marks";
import { Term } from "@/components/ui/term";
import type { ActiveGoalView } from "@/lib/goals/load";
import type { Goal, GoalKpi, MetricTotal, Milestone } from "@/lib/goals/schema";
import { formatMetric, GOAL_STATUS_LABEL, md, METRIC_UNIT, metricLabel, milestoneName, notCountedText, PROJECT_MIN_DAYS, spanText } from "@/lib/goals/view";
import { HelpTip } from "@/components/ui/help";
import type { RoadmapItem } from "@/lib/roadmap/load";
import { SNS } from "@/lib/sns";

// ロードマップの「いまの目標」の部品（段階 ②。docs/design/goals-model.md の 5.）。数は DB の goal_metric_total が数えたものだけを出す。
// 数えていない数字は、数の代わりに案内を出す（正しくない数字を見せない）

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <span className="h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
      <span className={`block h-full rounded-full ${className}`} style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
    </span>
  );
}

// 数えた最後の日（「11/4 までの数」。前は「11/4 まで」で、何のことか読めなかった。2026-11-21 PM の指摘）。今日まで数えていれば出さない
export function CountedThrough({ total, today }: { total: Pick<MetricTotal, "countedThrough">; today: string }) {
  if (!total.countedThrough || total.countedThrough >= today) return null;
  return <span className="num text-[13px] text-faint">{md(total.countedThrough)} までの数</span>;
}

// いまの目標（KGI）。ロードマップのいちばん上に置く（2026-11-21 オーナーの指示「この KGI が何なのかは一番重要で、一番意識しないといけないところ」）。
// 前は上に並んでいた「目標の進み具合」「期限まで」「期限の見込み」のカードも、ここにまとめる（同じことを 2 か所に出さない）。
// 数字には名前と単位を付ける（2026-11-21 オーナーの指摘「これって何の数字？」）。見込みが出ないときは、何をすれば出るかを書く
export function KgiCard({
  view,
  productType,
  today,
  empty,
  footer,
}: {
  view: ActiveGoalView | null;
  productType: string | null;
  today: string;
  // KGI がまだのときの中身（「AI と目標を決める」など）
  empty: ReactNode;
  // カードのいちばん下（「この目標を終える」など、押しまちがえたくないもの）
  footer?: ReactNode;
}) {
  const goal = view?.goal;
  const p = view?.progress ?? null;
  const metric = goal?.metric ?? null;
  const unit = metric && METRIC_UNIT[metric] ? ` ${METRIC_UNIT[metric]}` : "";
  const f = (v: number) => (metric ? `${formatMetric(metric, v)}${unit}` : String(v));
  return (
    <Card className="overflow-hidden">
      {/* 見出しに「KGI」と書かない（知らない言葉で止まる。確認役の指摘）。説明は点線の中に */}
      <CardHeader title={<Term k="kgi">いまの目標</Term>} action={goal?.metric && goal.endsOn ? <span className="num">{spanText(goal.startsOn, goal.endsOn)}</span> : undefined} />
      <div className="flex flex-col gap-3 px-6 pt-1 pb-5 max-sm:px-4">
        {metric && goal && goal.target !== null ? (
          <>
            <p className="text-[19px] font-bold">{goal.statement}</p>
            <p className="flex flex-wrap items-center gap-2 text-[15px] text-muted">
              {metricLabel({ metric, action: goal.action, sns: goal.sns }, productType)}を数えています
              {goal.provisional && <Badge tone="info">仮の目標</Badge>}
            </p>
            {p?.available ? (
              <>
                <div className="flex flex-col gap-2">
                  <p className="num flex flex-wrap items-baseline gap-x-3 whitespace-nowrap">
                    <span className="text-[15px] text-muted">いま</span>
                    <span className="text-[28px] font-bold max-sm:text-[24px]">{formatMetric(metric, p.value)}</span>
                    <span className="text-[17px] text-muted">
                      / {formatMetric(metric, p.target)}
                      {unit}
                    </span>
                  </p>
                  <span className="h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
                    <span className={`block h-full rounded-full ${p.value >= p.target ? "bg-success" : "bg-info"}`} style={{ width: `${Math.max(0, Math.min(100, p.target > 0 ? (p.value / p.target) * 100 : 0))}%` }} />
                  </span>
                </div>
                <p className="num flex flex-wrap items-baseline gap-x-3 text-[14px] text-muted">
                  <span>
                    残り {p.daysLeft} 日{goal.endsOn ? `。期限は ${md(goal.endsOn)}` : ""}
                  </span>
                  <CountedThrough total={p} today={today} />
                </p>
                <div className="flex flex-col gap-1 rounded-md bg-surface2 px-4 py-3 text-[15px]">
                  <p className="flex items-center gap-1.5 text-[14px] text-muted">
                    {goal.endsOn ? `このままなら ${md(goal.endsOn)} には` : "このままなら期限には"}
                    <HelpTip label="見込みの出し方">いまの 1 日あたりの数のまま、期限まで続けたときの数です。{PROJECT_MIN_DAYS} 日分の数字がたまると出ます。</HelpTip>
                  </p>
                  {p.projected !== null ? (
                    <p className="num flex flex-wrap items-baseline gap-x-2">
                      <b className="text-[20px]">{f(p.projected)}</b>
                      <span className="text-muted">目標 {f(p.target)}に</span>
                      {p.projected >= p.target ? <b className="text-success">届きそう</b> : <b className="text-signal">届かない見込み</b>}
                    </p>
                  ) : (
                    <p className="text-muted">{metric === "revenue" ? "売上は見込みを出しません" : `あと ${Math.max(1, PROJECT_MIN_DAYS - p.countedDays)} 日で、見込みの数が出ます`}</p>
                  )}
                </div>
              </>
            ) : (
              <p className="flex items-center gap-2 text-[15px] text-muted">
                <Badge>数えていません</Badge>
                {notCountedText(metric, productType)}
              </p>
            )}
          </>
        ) : (
          empty
        )}
      </div>
      {footer}
    </Card>
  );
}

// 中間の目標（4 週ごと）。過ぎた区切りは結果、いまの区切りは今日までの数、先の区切りは目標だけ
export function MilestonesCard({ view, productType, today }: { view: ActiveGoalView; productType: string | null; today: string }) {
  const { goal, milestones, current, currentProgress } = view;
  if (!goal.metric || milestones.length === 0) return null;
  const metric = goal.metric;
  return (
    <Card className="overflow-hidden">
      <CardHeader title={<Term k="milestone">中間の目標</Term>} action="4 週ごと" />
      <ul className="flex flex-col gap-3 px-6 pt-1 pb-5 max-sm:px-4">
        {milestones.map((m) => (
          <MilestoneRow key={m.id} m={m} metric={metric} isCurrent={current?.id === m.id} currentProgress={currentProgress} today={today} productType={productType} />
        ))}
      </ul>
    </Card>
  );
}

function MilestoneRow({ m, metric, isCurrent, currentProgress, today, productType }: { m: Milestone; metric: NonNullable<Goal["metric"]>; isCurrent: boolean; currentProgress: MetricTotal | null; today: string; productType: string | null }) {
  const value = isCurrent ? (currentProgress?.available ? currentProgress.value : null) : m.settledAt ? m.resultValue : null;
  const past = m.endsOn < today;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 text-[16px]">
        <span className={`font-bold ${isCurrent ? "" : "text-muted"}`}>{milestoneName(m.seq)}</span>
        <span className="num text-[13px] text-faint">{spanText(m.startsOn, m.endsOn)}</span>
        {isCurrent && <Badge tone="info">いま</Badge>}
        <span className="ml-auto num text-[18px] font-bold">
          {value !== null ? formatMetric(metric, value) : past || isCurrent ? "—" : ""}
          <span className="text-[15px] font-normal text-faint">{m.target !== null ? ` / ${formatMetric(metric, m.target)}` : value !== null || past || isCurrent ? "" : "目標なし"}</span>
        </span>
      </div>
      {isCurrent && currentProgress && !currentProgress.available && <p className="text-[13px] text-muted">{notCountedText(metric, productType)}</p>}
      {value !== null && m.target !== null && <Bar value={value} max={m.target} className={value >= m.target ? "bg-success" : "bg-info"} />}
      {isCurrent && currentProgress && <CountedThrough total={currentProgress} today={today} />}
    </li>
  );
}

// KPI と週の目標（今週の数）
export function KpisCard({ kpis, week, productType, today, footer }: { kpis: GoalKpi[]; week: Map<string, MetricTotal>; productType: string | null; today: string; footer?: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={<Term k="kpi">KPI と週の目標</Term>} action="今週" />
      {kpis.length ? (
        <ul className="flex flex-col gap-4 px-6 pt-2 pb-5 max-sm:px-4">
          {kpis.map((k) => {
            const t = week.get(k.id);
            return (
              <li key={k.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-3 text-[16px]">
                  <span className="min-w-0 flex-1 text-muted">{metricLabel(k, productType)}</span>
                  {t?.available ? (
                    <span className="num text-[18px] font-bold">
                      {formatMetric(k.metric, t.value)} <span className="text-[15px] font-normal text-faint">/ {formatMetric(k.metric, k.perWeek)}</span>
                    </span>
                  ) : (
                    <Badge>数えていません</Badge>
                  )}
                </div>
                {t?.available ? (
                  <>
                    <Bar value={t.value} max={k.perWeek} className={t.value >= k.perWeek ? "bg-success" : "bg-info"} />
                    <CountedThrough total={t} today={today} />
                  </>
                ) : (
                  <p className="text-[13px] text-muted">{notCountedText(k.metric, productType)}</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-6 pb-5 text-[15px] text-muted max-sm:px-4">まだ決めていません。</p>
      )}
      {footer}
    </Card>
  );
}

// 行動の目標（SNS ごとの週の投稿の本数。伴走が見守る）
export function ActionsCard({ actions, thisWeek, projectId }: { actions: GoalKpi[]; thisWeek: Partial<Record<string, number>>; projectId: string }) {
  const rows = actions.filter((a) => a.sns);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="週の投稿の本数"
        action={
          <Link href={`/projects/${projectId}/plan?open=first_month`} className="text-[14px] text-primary hover:underline">
            変える
          </Link>
        }
      />
      {rows.length ? (
        <ul className="flex flex-col gap-4 px-6 pt-2 pb-5 max-sm:px-4">
          {rows.map((a) => {
            const sns = a.sns!;
            const now = thisWeek[sns] ?? 0;
            return (
              <li key={a.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-3 text-[16px]">
                  <span className="min-w-0 flex-1 text-muted">{SNS[sns].label}</span>
                  <span className="num text-[18px] font-bold">
                    {now} <span className="text-[15px] font-normal text-faint">/ {a.perWeek} 本</span>
                  </span>
                </div>
                <Bar value={now} max={a.perWeek} className={now >= a.perWeek ? "bg-success" : SNS_COLOR[sns].bg} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-6 pb-5 text-[15px] text-muted max-sm:px-4">まだ決めていません。</p>
      )}
    </Card>
  );
}

const STATUS_TONE = { achieved: "success", expired: "neutral", replaced: "neutral" } as const;

// これまでの目標（閉じた目標を新しい順に。開くとその目標のタスク）
export function PastGoals({ past, items, productType, renderItems }: { past: Goal[]; items: RoadmapItem[]; productType: string | null; renderItems: (items: RoadmapItem[]) => ReactNode }) {
  // KGI を決めていなかった期間は、タスクがあるときだけ出す
  const shown = past.filter((g) => g.metric !== null || items.some((i) => i.goalId === g.id));
  if (shown.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader title="これまでの目標" action={`${shown.length} 件`} />
      <ul>
        {shown.map((g) => {
          const own = items.filter((i) => i.goalId === g.id);
          const status = g.status === "active" ? null : g.status;
          return (
            <li key={g.id} className="border-t border-line">
              <DismissableDetails>
                {/* 行ぜんぶが押せる（ホバーで地を変え、右端に ⌄。開くと ⌃）（2026-11-20 オーナーの指示） */}
                <summary className="flex cursor-pointer list-none items-center gap-3 px-6 py-3 hover:bg-subtle max-sm:px-4 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 font-bold">{g.statement ?? "目標を決めていなかった期間"}</span>
                  <span className="num text-[13px] text-faint">{spanText(g.startsOn, g.endsOn ?? (g.closedAt ? g.closedAt.slice(0, 10) : null))}</span>
                  {g.metric && g.target !== null && (
                    <span className="num text-[15px] font-bold">
                      {g.resultValue !== null ? formatMetric(g.metric, g.resultValue) : "—"}
                      <span className="font-normal text-faint"> / {formatMetric(g.metric, g.target)}</span>
                    </span>
                  )}
                  {status && <Badge tone={STATUS_TONE[status]}>{GOAL_STATUS_LABEL[status]}</Badge>}
                  </span>
                  <DisclosureChevron />
                </summary>
                <div className="px-6 pb-3 max-sm:px-4">
                  {g.metric && <p className="text-[13px] text-muted">{metricLabel({ metric: g.metric, action: g.action, sns: g.sns }, productType)}</p>}
                  {own.length ? <ul>{renderItems(own)}</ul> : <p className="py-2 text-[14px] text-muted">この目標のタスクはありません。</p>}
                </div>
              </DismissableDetails>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
