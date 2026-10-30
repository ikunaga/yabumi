import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddItemForm } from "@/components/roadmap/add-item-form";
import { GoalForm } from "@/components/roadmap/goal-form";
import { RoadmapItemRow } from "@/components/roadmap/item-row";
import { ButtonLink, NotReadyButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { DismissableDetails } from "@/components/ui/dismissable-details";
import { HelpTip } from "@/components/ui/help";
import { SNS_COLOR } from "@/components/ui/marks";
import { BarRow, Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/page-header";
import { Term } from "@/components/ui/term";
import { aiConfigured } from "@/lib/ai/anthropic";
import { recommendedKpis } from "@/lib/metrics/kpis";
import { getAccountPlan } from "@/lib/plan/queries";
import { getProject } from "@/lib/projects/queries";
import { loadRoadmap, type RoadmapItem } from "@/lib/roadmap/queries";
import { formatValue, isAutoKpi, itemProgress, kpiLabel, notCountedYet, weekValue } from "@/lib/roadmap/schema";
import { addDays, dayOfMonth, monthOf } from "@/lib/time";

export const metadata: Metadata = { title: "ロードマップ" };

function weekLabel(weekStart: string, thisWeek: string): string {
  const diff = Math.round((new Date(`${weekStart}T00:00:00Z`).getTime() - new Date(`${thisWeek}T00:00:00Z`).getTime()) / (7 * 86_400_000));
  const range = `${monthOf(weekStart)}/${dayOfMonth(weekStart)}〜`;
  if (diff === 0) return `今週（${range}）`;
  if (diff === 1) return `来週（${range}）`;
  if (diff < 0) return `${-diff} 週前（${range}）`;
  return `${diff} 週後（${range}）`;
}

// ロードマップ（F10、docs/architecture.md の 4.23）: 最終の目標（KGI）、追いかける数字（KPI）、週ごとのやること
export default async function RoadmapPage(props: PageProps<"/projects/[id]/roadmap">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const [view, plan] = await Promise.all([loadRoadmap(id), getAccountPlan(id)]);
  const { roadmap, items, thisWeek, daily, kgi } = view;
  const suggested = plan?.plan.first_month.kpis.length ? plan.plan.first_month.kpis : recommendedKpis(plan?.plan.goal.goalType ?? null);
  const consultHref = `/projects/${id}/consult/new?start=roadmap`;
  const ai = aiConfigured();

  const groups: { key: string; label: string; items: RoadmapItem[] }[] = [];
  for (const item of items) {
    // 済んだ・やらないことにした過去の週は、折りたたみに回す
    if (item.weekStart < thisWeek && item.status !== "todo") continue;
    const key = item.weekStart < thisWeek ? "overdue" : item.weekStart;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: key === "overdue" ? "まだ済んでいない、前の週のこと" : weekLabel(item.weekStart, thisWeek), items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }
  groups.sort((a, b) => (a.key === "overdue" ? -1 : b.key === "overdue" ? 1 : a.key.localeCompare(b.key)));
  const past = items.filter((i) => i.weekStart < thisWeek && i.status !== "todo");
  const thisWeekTodo = items.filter((i) => i.weekStart === thisWeek && i.status === "todo").length;
  const thisWeekDone = items.filter((i) => i.weekStart === thisWeek && i.status === "done").length;
  const weeks = Array.from({ length: 9 }, (_, n) => addDays(thisWeek, n * 7)).map((w) => ({ value: w, label: weekLabel(w, thisWeek) }));

  return (
    <div className="flex max-w-[1280px] flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title={<Term k="roadmap">ロードマップ</Term>}
        help={
          <>
            <Term k="kgi">最終の目標</Term>と、そこへ向かう週ごとのやること。追いかける数字（<Term k="kpi" />）は、数えられるものから自動で進み具合を出します。
          </>
        }
        actions={ai ? <ButtonLink href={consultHref}>{roadmap?.kgi ? "AI と見直す" : "AI と作る"}</ButtonLink> : <NotReadyButton>AI と作る</NotReadyButton>}
      />

      {/* 数字の段（見本 A の上の 4 つ） */}
      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:gap-3">
        <Metric
          label="目標の進み具合"
          value={kgi && roadmap?.kgi ? formatValue(roadmap.kgi.kpi, kgi.actual) : "—"}
          note={kgi && roadmap?.kgi ? `/ ${formatValue(roadmap.kgi.kpi, kgi.target)}` : roadmap?.kgi ? "準備中" : "まだ決めていません"}
        />
        <Metric label="期限まで" value={kgi ? kgi.daysLeft : "—"} unit={kgi ? "日" : undefined} note={roadmap?.kgi ? roadmap.kgi.deadline : undefined} />
        <Metric label="今週のやること" value={thisWeekTodo} unit="件" note={`済み ${thisWeekDone} 件`} />
        <Metric
          label="期限の見込み"
          value={kgi?.projected != null && roadmap?.kgi ? formatValue(roadmap.kgi.kpi, kgi.projected) : "—"}
          note={kgi?.onTrack === true ? <span className="font-bold text-success">届きそう</span> : kgi?.onTrack === false ? <span className="font-bold text-signal">届かない見込み</span> : "続けてから見ます"}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="最終の目標（KGI）" action={roadmap?.kgi ? <span className="num">数え始め {roadmap.startedOn}</span> : undefined} />
        <div className="flex flex-col gap-3 px-6 pt-1 pb-5 max-sm:px-4">
          {roadmap?.kgi ? (
            <>
              <p className="text-[19px] font-bold">{roadmap.kgi.statement}</p>
              <p className="text-[15px] text-muted">
                {kpiLabel(roadmap.kgi.kpi, roadmap.kgi.sns)}を {formatValue(roadmap.kgi.kpi, roadmap.kgi.target)}、期限 {roadmap.kgi.deadline}
              </p>
              {kgi ? (
                <BarRow
                  label="いま"
                  value={kgi.actual}
                  max={kgi.target}
                  display={`${formatValue(roadmap.kgi.kpi, kgi.actual)} / ${formatValue(roadmap.kgi.kpi, kgi.target)}`}
                />
              ) : (
                <p className="flex items-center gap-2 text-[15px] text-muted">
                  <Badge>準備中</Badge>
                  {notCountedYet(roadmap.kgi.kpi)}
                </p>
              )}
              {kgi?.onTrack === false && <p className="text-[15px] text-signal">このままの調子だと届かない見込みです。やることを見直すか、目標を調整しましょう。</p>}
            </>
          ) : (
            <p className="text-[15px] text-muted">まだ決めていません。「{ai ? "AI と作る" : "目標を手で決める"}」から決められます。</p>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              追いかける数字と 1 週の目標
              <HelpTip label="追いかける数字">
                SNS ごとの「投稿した回数」は、アカウント設計の「最初の 1 か月」の週の回数と同じ数字です（どちらで変えても揃います）。伴走が、この回数でペースを見守ります（概要の「いまやること」の帯）。
              </HelpTip>
            </span>
          }
          action="今週"
        />
        {roadmap?.kpiTargets.length ? (
          <ul className="flex flex-col gap-4 px-6 pt-2 pb-5 max-sm:px-4">
            {roadmap.kpiTargets.map((t) => {
              const now = weekValue(t.kpi, thisWeek, daily, t.sns);
              const last = weekValue(t.kpi, addDays(thisWeek, -7), daily, t.sns);
              return (
                <li key={`${t.kpi}:${t.sns ?? ""}`} className="flex flex-col gap-1.5">
                  {/* 名前が長い（「投稿した回数（Instagram）」など）ので、名前と数字の行の下に横棒を引く */}
                  <div className="flex items-baseline gap-3 text-[16px]">
                    <span className="min-w-0 flex-1 text-muted">{kpiLabel(t.kpi, t.sns)}</span>
                    {isAutoKpi(t.kpi) && now !== null ? (
                      <>
                        {last !== null && <span className="num text-[13px] text-faint">先週 {formatValue(t.kpi, last)}</span>}
                        <span className="num text-[18px] font-bold">
                          {formatValue(t.kpi, now)} <span className="text-[15px] font-normal text-faint">/ {formatValue(t.kpi, t.per_week)}</span>
                        </span>
                      </>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Badge>準備中</Badge>
                        <HelpTip label="準備中の数字" align="right">
                          {notCountedYet(t.kpi)}
                        </HelpTip>
                      </span>
                    )}
                  </div>
                  {isAutoKpi(t.kpi) && now !== null && (
                    <span className="h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
                      <span
                        className={`block h-full rounded-full ${now >= t.per_week ? "bg-success" : t.sns ? SNS_COLOR[t.sns].bg : "bg-info"}`}
                        style={{ width: `${Math.min(100, (now / t.per_week) * 100)}%` }}
                      />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-6 pb-5 text-[15px] text-muted max-sm:px-4">まだ決めていません。</p>
        )}
        <DismissableDetails className="border-t border-line px-6 py-3 max-sm:px-4">
          <summary className="cursor-pointer text-[14px] font-semibold text-primary">目標と数字を手で決める・直す</summary>
          <div className="pt-3" />
          <GoalForm projectId={id} kgi={roadmap?.kgi ?? null} kpiTargets={roadmap?.kpiTargets ?? []} suggested={suggested} />
        </DismissableDetails>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="週ごとのやること" />
        {groups.length === 0 ? (
          <EmptyState
            title="まだやることがありません"
            description="1 週に 1〜3 個、30 分ほどで済むことを置くのがおすすめです。AI と相談すると、目標から週ごとのやることを提案します。"
          />
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h3 className="border-b border-line bg-surface2 px-6 py-2 text-[13px] font-bold text-muted max-sm:px-4">{g.label}</h3>
              <ul>
                {g.items.map((item) => (
                  <RoadmapItemRow
                    key={item.id}
                    projectId={id}
                    item={item}
                    progress={itemProgress(item, daily)}
                    notCounted={item.kpi ? notCountedYet(item.kpi) : null}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
        <div className="border-t border-line">
          <AddItemForm projectId={id} weeks={weeks} />
        </div>
        {past.length > 0 && (
          <DismissableDetails className="border-t border-line px-6 py-3 max-sm:px-4">
            <summary className="cursor-pointer text-[14px] font-semibold text-primary">済んだこと・やらないことにしたこと（{past.length} 件）</summary>
            <ul>
              {past.map((item) => (
                <RoadmapItemRow key={item.id} projectId={id} item={item} progress={itemProgress(item, daily)} notCounted={item.kpi ? notCountedYet(item.kpi) : null} />
              ))}
            </ul>
          </DismissableDetails>
        )}
      </Card>
    </div>
  );
}
