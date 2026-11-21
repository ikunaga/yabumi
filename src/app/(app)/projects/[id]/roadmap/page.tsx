import { ConsultClosedBanner } from "@/components/ai/consult-closed-banner";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddItemForm } from "@/components/roadmap/add-item-form";
import { ActionsCard, KgiCard, KpisCard, MilestonesCard, PastGoals } from "@/components/roadmap/goal-cards";
import { GoalForm } from "@/components/roadmap/goal-form";
import { RoadmapItemRow } from "@/components/roadmap/item-row";
import { GoalRiskPanel } from "@/components/roadmap/goal-risk";
import { SettleGoalButton } from "@/components/roadmap/settle-goal-button";
import { ActionBar } from "@/components/ui/action-bar";
import { ButtonLink, NotReadyButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Columns } from "@/components/ui/columns";
import { Metric } from "@/components/ui/metric";
import { HelpTip } from "@/components/ui/help";
import { PageHeader } from "@/components/ui/page-header";
import { Term } from "@/components/ui/term";
import { aiConfigured } from "@/lib/ai/anthropic";
import { getGoals, kpiWeekTotals } from "@/lib/goals/queries";
import { isLegacyActionGoal, kgiMetricFor } from "@/lib/goals/schema";
import { goalRisk, reviseChoices } from "@/lib/goals/risk";
import { formatMetric, md, METRIC_UNIT, metricLabel, PROJECT_MIN_DAYS } from "@/lib/goals/view";
import { getAccountPlan } from "@/lib/plan/queries";
import { getProject } from "@/lib/projects/queries";
import { itemState, loadRoadmap, thisWeekCounts, type RoadmapItem } from "@/lib/roadmap/queries";
import { itemProgress, notCountedYet, weekValue } from "@/lib/roadmap/schema";
import { SNS_KEYS } from "@/lib/sns";
import { addDays, dayOfMonth, monthOf } from "@/lib/time";
import { DisclosureBox } from "@/components/ui/disclosure";

export const metadata: Metadata = { title: "ロードマップ" };

function weekLabel(weekStart: string, thisWeek: string): string {
  const diff = Math.round((new Date(`${weekStart}T00:00:00Z`).getTime() - new Date(`${thisWeek}T00:00:00Z`).getTime()) / (7 * 86_400_000));
  const range = `${monthOf(weekStart)}/${dayOfMonth(weekStart)}〜`;
  if (diff === 0) return `今週（${range}）`;
  if (diff === 1) return `来週（${range}）`;
  if (diff < 0) return `${-diff} 週前（${range}）`;
  return `${diff} 週後（${range}）`;
}

// ロードマップ（F10、docs/architecture.md の 4.23・docs/design/goals-model.md の 5.）: いまの目標（KGI）・中間の目標・KPI・週の投稿の本数、
// 週ごとのやること、これまでの目標
export default async function RoadmapPage(props: PageProps<"/projects/[id]/roadmap">) {
  const [{ id }, { done, items: doneItems, reviewed, revise }] = await Promise.all([props.params, props.searchParams]);
  // id だけで読めるので、プロジェクトと並べて読む（待ち時間を縮める）
  const [project, view, plan, goals] = await Promise.all([getProject(id), loadRoadmap(id), getAccountPlan(id), getGoals(id)]);
  if (!project) notFound();
  const { items: allItems, thisWeek, daily } = view;
  const active = goals.active;
  const goal = active?.goal ?? null;
  const kpiWeek = await kpiWeekTotals(id, active?.kpis ?? [], thisWeek, addDays(thisWeek, 6));
  const consultHref = `/projects/${id}/consult/new?start=roadmap`;
  const ai = aiConfigured();
  const legacy = goal ? isLegacyActionGoal(goal) : false;
  const hasKgi = Boolean(goal?.metric && goal.target !== null) && !legacy;
  const p = hasKgi ? (active?.progress ?? null) : null;
  // 数字の名前（「プロフィールのリンクのクリック」）と、文の中に添える単位（「 回」。売上は formatMetric が円を付ける）
  const metricName = goal?.metric ? metricLabel({ metric: goal.metric, action: goal.action, sns: goal.sns }, project.product_type) : "";
  const unitOf = (m: NonNullable<typeof goal>["metric"]) => (m && METRIC_UNIT[m] ? ` ${METRIC_UNIT[m]}` : "");
  // 届かない見込み（数え始めて 14 日から。src/lib/goals/risk.ts）と、AI なしで選べる見直しの案
  const risk = hasKgi && goal ? goalRisk(goal, p) : null;
  const choices = risk && goal ? reviseChoices(goal, risk) : [];

  // いまの目標のやること（目標を替えたとき、今週以降のまだのものは新しい目標に移る）。前の目標のものは「これまでの目標」に
  const items = allItems.filter((i) => !goal || i.goalId === null || i.goalId === goal.id);
  const stateOf = (item: RoadmapItem) => itemState(item, daily);
  const groups: { key: string; label: string; items: RoadmapItem[] }[] = [];
  for (const item of items) {
    // 済んだ（数字で達成した）・やらないことにした過去の週は、折りたたみに回す
    if (item.weekStart < thisWeek && stateOf(item) !== "todo") continue;
    const key = item.weekStart < thisWeek ? "overdue" : item.weekStart;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: key === "overdue" ? "まだ完了していない、前の週のこと" : weekLabel(item.weekStart, thisWeek), items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }
  groups.sort((a, b) => (a.key === "overdue" ? -1 : b.key === "overdue" ? 1 : a.key.localeCompare(b.key)));
  const past = items.filter((i) => i.weekStart < thisWeek && stateOf(i) !== "todo");
  const { open: thisWeekTodo, finished: thisWeekDone } = thisWeekCounts(view);
  const weeks = Array.from({ length: 9 }, (_, n) => addDays(thisWeek, n * 7)).map((w) => ({ value: w, label: weekLabel(w, thisWeek) }));
  const row = (item: RoadmapItem) => (
    <RoadmapItemRow key={item.id} projectId={id} item={item} aiEnabled={ai} progress={itemProgress(item, daily)} notCounted={item.kpi ? notCountedYet(item.kpi, project.product_type) : null} />
  );
  const postsThisWeek = Object.fromEntries(SNS_KEYS.map((s) => [s, weekValue("posts", thisWeek, daily, s) ?? 0]));

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title={<Term k="roadmap">ロードマップ</Term>}
        help={
          <>
            3 か月の成果の目標（<Term k="kgi" />）と 4 週ごとの<Term k="milestone">中間の目標</Term>、そこへ向かう週ごとのやること。途中の数字（<Term k="kpi" />）は、数えられるものから自動で進み具合を出します。
          </>
        }
        actions={ai ? <ButtonLink href={consultHref}>{hasKgi ? "AI と見直す" : "AI と作る"}</ButtonLink> : <NotReadyButton>AI と作る</NotReadyButton>}
      />
      <ConsultClosedBanner projectId={id} done={done} items={doneItems} reviewed={reviewed} roadmapLink={false} />

      {/* 前の KGI（投稿の本数）は、成果の目標に変えてもらう（オーナーの決定 Q2。自動では変えない） */}
      {legacy && (
        <ActionBar
          label={<span className="text-signal">● 要確認</span>}
          title="いまの目標は投稿の本数です。成果の目標に変えましょう"
          action={
            ai ? (
              <ButtonLink href={consultHref} size="sm">
                AI と変える
              </ButtonLink>
            ) : (
              <ButtonLink href="#goal-form" size="sm">
                手で決める
              </ButtonLink>
            )
          }
        />
      )}

      {/* 数字の段（見本 A の上の 4 つ） */}
      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:gap-3">
        {/* 何の数字かがわかるように、数字の名前と単位を出す（2026-11-21 オーナーの指摘「これって何の数字？」） */}
        <Metric
          label="目標の進み具合"
          value={p?.available && goal?.metric ? formatMetric(goal.metric, p.value) : "—"}
          unit={p?.available && goal?.metric ? METRIC_UNIT[goal.metric] || undefined : undefined}
          note={
            !hasKgi || !goal?.metric ? (
              "まだ決めていません"
            ) : (
              <>
                {p?.available ? `目標 ${formatMetric(goal.metric, p.target)}${unitOf(goal.metric)}` : "数えていません"}
                <span className="block truncate">{metricName}</span>
              </>
            )
          }
        />
        <Metric label="期限まで" value={p ? p.daysLeft : "—"} unit={p ? "日" : undefined} note={hasKgi && goal?.endsOn ? md(goal.endsOn) : undefined} />
        <Metric label="今週のやること" value={thisWeekTodo} unit="件" note={`完了 ${thisWeekDone} 件`} />
        <Metric
          label={
            <span className="inline-flex items-center gap-1.5">
              {hasKgi && goal?.endsOn ? `${md(goal.endsOn)} の見込み` : "期限の見込み"}
              <HelpTip label="見込みの出し方">今までの 1 日あたりの数で、期限まで続けたときの数です。数え始めて {PROJECT_MIN_DAYS} 日たつと出ます。</HelpTip>
            </span>
          }
          value={p?.projected != null && goal?.metric ? formatMetric(goal.metric, p.projected) : "—"}
          unit={p?.projected != null && goal?.metric ? METRIC_UNIT[goal.metric] || undefined : undefined}
          note={
            !hasKgi || !goal?.metric || !p ? (
              "まだ決めていません"
            ) : p.projected != null ? (
              <>
                このペースなら。目標 {formatMetric(goal.metric, p.target)}
                {unitOf(goal.metric)}{" "}
                {p.projected >= p.target ? <span className="font-bold text-success">届きそう</span> : <span className="font-bold text-signal">届かない見込み</span>}
              </>
            ) : !p.available ? (
              "数えていません"
            ) : goal.metric === "revenue" ? (
              "売上は見込みを出しません"
            ) : (
              `あと ${Math.max(1, PROJECT_MIN_DAYS - p.countedDays)} 日数えると出ます`
            )
          }
        />
      </div>

      {risk && goal?.metric && goal.endsOn && (
        <GoalRiskPanel
          projectId={id}
          goalId={goal.id}
          metric={goal.metric}
          metricName={metricLabel({ metric: goal.metric, action: goal.action, sns: goal.sns }, project.product_type)}
          statement={goal.statement ?? ""}
          endsOn={goal.endsOn}
          risk={risk}
          choices={choices}
          rescueHref={ai ? `/projects/${id}/consult/new?start=goal_rescue` : null}
          openRevise={revise === "1"}
        />
      )}

      <Columns
        main={
          <>
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
                    <ul>{g.items.map(row)}</ul>
                  </section>
                ))
              )}
              <div className="border-t border-line">
                <AddItemForm projectId={id} weeks={weeks} />
              </div>
              {past.length > 0 && (
                <DisclosureBox label="完了したこと・やらないことにしたことを表示" count={past.length} className="border-t border-line px-6 py-3 max-sm:px-4">
                  <ul>{past.map(row)}</ul>
                </DisclosureBox>
              )}
            </Card>
          </>
        }
        side={
          <>
            <KgiCard
              view={hasKgi ? active : null}
              productType={project.product_type}
              today={goals.today}
              empty={
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[15px] text-muted">
                    {legacy ? `前の目標「${goal?.statement ?? ""}」は投稿の本数です。` : "まだ決めていません。"}
                    見た人にしてほしいことに合わせた、3 か月の成果の数字にしましょう。
                  </p>
                  {ai && (
                    <ButtonLink href={consultHref} size="sm">
                      AI と目標を決める
                    </ButtonLink>
                  )}
                </div>
              }
              footer={
                hasKgi && goal ? (
                  <div className="border-t border-line px-6 py-3 max-sm:px-4">
                    <SettleGoalButton projectId={id} goalId={goal.id} statement={goal.statement ?? ""} />
                  </div>
                ) : null
              }
            />
            {active && hasKgi && <MilestonesCard view={active} productType={project.product_type} today={goals.today} />}
            <KpisCard
              kpis={active?.kpis ?? []}
              week={kpiWeek}
              productType={project.product_type}
              today={goals.today}
              footer={
                <DisclosureBox label="目標と数字を手で決める欄を表示" id="goal-form" className="border-t border-line px-6 py-3 max-sm:px-4" bodyClassName="mt-3">
                  <GoalForm
                    projectId={id}
                    goal={goal}
                    milestones={active?.milestones ?? []}
                    kpis={active?.kpis ?? []}
                    suggested={kgiMetricFor(plan?.plan.goal.goalType ?? null)}
                    productType={project.product_type}
                    today={goals.today}
                  />
                </DisclosureBox>
              }
            />
            <ActionsCard actions={active?.actions ?? []} thisWeek={postsThisWeek} projectId={id} />
          </>
        }
      />
      {/* これまでの目標（いちばん下。スマホでも、いまの目標とやることのあと） */}
      <PastGoals past={goals.past} items={allItems} productType={project.product_type} renderItems={(list) => list.map(row)} />
    </div>
  );
}
