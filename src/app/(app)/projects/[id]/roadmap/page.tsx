import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddItemForm } from "@/components/roadmap/add-item-form";
import { GoalForm } from "@/components/roadmap/goal-form";
import { RoadmapItemRow } from "@/components/roadmap/item-row";
import { ButtonLink, NotReadyButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { DismissableDetails } from "@/components/ui/dismissable-details";
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
  const weeks = Array.from({ length: 9 }, (_, n) => addDays(thisWeek, n * 7)).map((w) => ({ value: w, label: weekLabel(w, thisWeek) }));

  return (
    <div className="flex max-w-[880px] flex-col gap-6 max-sm:gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">
            <Term k="roadmap">ロードマップ</Term>
          </h1>
          <p className="text-[14px] leading-[1.8] text-muted">
            <Term k="kgi">最終の目標</Term>と、そこへ向かう週ごとのやること。追いかける数字（<Term k="kpi" />）は、数えられるものから自動で進み具合を出します。
          </p>
        </div>
        {ai ? (
          <ButtonLink href={consultHref}>{roadmap?.kgi ? "AI と見直す" : "AI と作る"}</ButtonLink>
        ) : (
          <NotReadyButton>AI と作る</NotReadyButton>
        )}
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="最終の目標（KGI）" />
        <div className="flex flex-col gap-3 px-5 py-4 text-[14px] leading-7 max-sm:px-4">
          {roadmap?.kgi ? (
            <>
              <p className="text-lg font-bold">{roadmap.kgi.statement}</p>
              <p className="text-muted">
                {kpiLabel(roadmap.kgi.kpi, roadmap.kgi.sns)}を {formatValue(roadmap.kgi.kpi, roadmap.kgi.target)}、期限 {roadmap.kgi.deadline}（数え始め {roadmap.startedOn}）
              </p>
              {kgi ? (
                <div className="flex flex-col gap-1.5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface2" aria-hidden>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(kgi.ratio * 100)}%` }} />
                  </div>
                  <p>
                    いま {formatValue(roadmap.kgi.kpi, kgi.actual)} / {formatValue(roadmap.kgi.kpi, kgi.target)}（残り {kgi.daysLeft} 日）。
                    {kgi.onTrack === null
                      ? "始めたばかりなので、調子はもう少し続けてから見ます。"
                      : kgi.onTrack
                        ? `このままの調子なら、期限までに届きそうです（見込み ${formatValue(roadmap.kgi.kpi, kgi.projected ?? 0)}）。`
                        : `このままの調子だと、期限までに届かない見込みです（見込み ${formatValue(roadmap.kgi.kpi, kgi.projected ?? 0)}）。やることを見直すか、目標を調整しましょう。`}
                  </p>
                </div>
              ) : (
                <p className="text-muted">進み具合: 準備中（{notCountedYet(roadmap.kgi.kpi)}）</p>
              )}
            </>
          ) : (
            <p className="text-muted">まだ決めていません。「{ai ? "AI と作る" : "目標を手で決める"}」から、アカウント設計の「最初の 1 か月」をもとに決められます。</p>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="追いかける数字と 1 週の目標" />
        {roadmap?.kpiTargets.length ? (
          <ul>
            {roadmap.kpiTargets.map((t) => {
              const now = weekValue(t.kpi, thisWeek, daily, t.sns);
              const last = weekValue(t.kpi, addDays(thisWeek, -7), daily, t.sns);
              return (
                <li key={`${t.kpi}:${t.sns ?? ""}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-[14px] last:border-b-0 max-sm:px-4">
                  <b className="w-56 max-sm:w-auto">{kpiLabel(t.kpi, t.sns)}</b>
                  <span>1 週に {formatValue(t.kpi, t.per_week)}</span>
                  {isAutoKpi(t.kpi) && now !== null ? (
                    <span className="text-muted">
                      今週 {formatValue(t.kpi, now)}・先週 {formatValue(t.kpi, last ?? 0)}
                      {now >= t.per_week && <span className="ml-2 font-bold text-success">今週の目標に届きました</span>}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">準備中（{notCountedYet(t.kpi)}）</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-4 text-[14px] text-muted max-sm:px-4">まだ決めていません。</p>
        )}
        <DismissableDetails className="border-t border-line px-5 py-3 max-sm:px-4">
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
              <h3 className="border-b border-line bg-surface2 px-5 py-2 text-xs font-bold text-muted max-sm:px-4">{g.label}</h3>
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
          <DismissableDetails className="border-t border-line px-5 py-3 max-sm:px-4">
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
