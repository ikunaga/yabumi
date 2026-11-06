import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { DismissableDetails } from "@/components/ui/dismissable-details";
import { SNS_COLOR } from "@/components/ui/marks";
import { BarRow } from "@/components/ui/metric";
import { Term } from "@/components/ui/term";
import type { ActiveGoalView } from "@/lib/goals/load";
import type { Goal, GoalKpi, MetricTotal, Milestone } from "@/lib/goals/schema";
import { formatMetric, GOAL_STATUS_LABEL, md, metricLabel, milestoneName, notCountedText, spanText } from "@/lib/goals/view";
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

// 数えた最後の日（「11/4 まで」）。今日まで数えていれば出さない
export function CountedThrough({ total, today }: { total: Pick<MetricTotal, "countedThrough">; today: string }) {
  if (!total.countedThrough || total.countedThrough >= today) return null;
  return <span className="num text-[13px] text-faint">{md(total.countedThrough)} まで</span>;
}

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
  footer?: ReactNode;
}) {
  const goal = view?.goal;
  const p = view?.progress ?? null;
  return (
    <Card className="overflow-hidden">
      <CardHeader title={<Term k="kgi">いまの目標（KGI）</Term>} action={goal?.metric && goal.endsOn ? <span className="num">{spanText(goal.startsOn, goal.endsOn)}</span> : undefined} />
      <div className="flex flex-col gap-3 px-6 pt-1 pb-5 max-sm:px-4">
        {goal?.metric && goal.target !== null ? (
          <>
            <p className="text-[19px] font-bold">{goal.statement}</p>
            <p className="flex flex-wrap items-center gap-2 text-[15px] text-muted">
              {metricLabel({ metric: goal.metric, action: goal.action, sns: goal.sns }, productType)} {formatMetric(goal.metric, goal.target)}
              {goal.provisional && <Badge tone="info">仮の目標</Badge>}
            </p>
            {p?.available ? (
              <>
                <BarRow label="いま" value={p.value} max={p.target} barClass={p.value >= p.target ? "bg-success" : "bg-info"} display={`${formatMetric(goal.metric, p.value)} / ${formatMetric(goal.metric, p.target)}`} />
                <p className="flex flex-wrap items-baseline gap-x-3 text-[14px] text-muted">
                  <span>残り {p.daysLeft} 日</span>
                  {p.projected !== null && (
                    <span>
                      このままだと <b className={`num ${p.projected >= p.target ? "text-success" : "text-signal"}`}>{formatMetric(goal.metric, p.projected)}</b>
                    </span>
                  )}
                  <CountedThrough total={p} today={today} />
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-[15px] text-muted">
                <Badge>数えていません</Badge>
                {notCountedText(goal.metric, productType)}
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

// これまでの目標（閉じた目標を新しい順に。開くとその目標のやること）
export function PastGoals({ past, items, productType, renderItems }: { past: Goal[]; items: RoadmapItem[]; productType: string | null; renderItems: (items: RoadmapItem[]) => ReactNode }) {
  // KGI を決めていなかった期間は、やることがあるときだけ出す
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
              <DismissableDetails className="px-6 py-3 max-sm:px-4">
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1 font-bold">{g.statement ?? "目標を決めていなかった期間"}</span>
                  <span className="num text-[13px] text-faint">{spanText(g.startsOn, g.endsOn ?? (g.closedAt ? g.closedAt.slice(0, 10) : null))}</span>
                  {g.metric && g.target !== null && (
                    <span className="num text-[15px] font-bold">
                      {g.resultValue !== null ? formatMetric(g.metric, g.resultValue) : "—"}
                      <span className="font-normal text-faint"> / {formatMetric(g.metric, g.target)}</span>
                    </span>
                  )}
                  {status && <Badge tone={STATUS_TONE[status]}>{GOAL_STATUS_LABEL[status]}</Badge>}
                </summary>
                <div className="pt-2">
                  {g.metric && <p className="text-[13px] text-muted">{metricLabel({ metric: g.metric, action: g.action, sns: g.sns }, productType)}</p>}
                  {own.length ? <ul>{renderItems(own)}</ul> : <p className="py-2 text-[14px] text-muted">この目標のやることはありません。</p>}
                </div>
              </DismissableDetails>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
