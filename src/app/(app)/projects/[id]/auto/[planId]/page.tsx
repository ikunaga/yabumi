import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { scheduleText } from "@/components/auto-post/format";
import { PlanControls } from "@/components/auto-post/plan-controls";
import { PlanStatusMark } from "@/components/auto-post/status-mark";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { SuccessBanner } from "@/components/ui/feedback";
import { SnsTag } from "@/components/ui/marks";
import { Metric } from "@/components/ui/metric";
import { KIND_LABELS, RUN_REASON_TEXT, RUN_STATUS_LABELS, TARGET_MODE_LABELS } from "@/lib/auto-post/labels";
import { getAutoPlan, listAutoRuns, listUpcomingAutoRuns } from "@/lib/auto-post/queries";
import type { AutoRun } from "@/lib/auto-post/types";
import type { SnsKey } from "@/lib/sns";
import { loadRunResults, type RunTargetResult } from "@/lib/auto-post/ui-queries";
import { getProject } from "@/lib/projects/queries";
import { formatShort } from "@/lib/time";

export const metadata: Metadata = { title: "自動の投稿" };

const DAY_MS = 86_400_000;

// 回し方の画面（docs/design/auto-post.md の 1.6・1.7）。上に数字 3 つ、下に回の一覧、横（スマホは上）に操作
export default async function AutoPlanPage(props: PageProps<"/projects/[id]/auto/[planId]">) {
  const [{ id, planId }, { saved }] = await Promise.all([props.params, props.searchParams]);
  const [project, plan] = await Promise.all([getProject(id), getAutoPlan(planId)]);
  if (!project || !plan || plan.projectId !== project.id) notFound();
  const now = new Date();
  const [runs, upcoming] = await Promise.all([listAutoRuns(plan.id, 50), listUpcomingAutoRuns(project.id, now, new Date(now.getTime() + 90 * DAY_MS))]);
  const results = await loadRunResults(runs.flatMap((r) => (r.postId ? [r.postId] : [])));
  const next = upcoming.find((u) => u.planId === plan.id) ?? null;

  const past = runs.filter((r) => new Date(r.dueAt) <= now || ["held", "skipped", "canceled"].includes(r.status));
  const sentRuns = past.filter((r) => r.postId && (results.get(r.postId) ?? []).some((t) => t.status === "published"));
  const heldCount = runs.filter((r) => r.status === "held").length;
  const views = sentRuns.flatMap((r) => (results.get(r.postId!) ?? []).map((t) => t.views)).filter((v): v is number => v !== null);
  const avgViews = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / sentRuns.length) : null;
  const sns = Object.keys(plan.targets) as SnsKey[];
  const base = `/projects/${project.id}`;

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <div className="flex flex-col gap-3">
        <Link href={`${base}/auto`} className="text-sm text-muted underline">
          ← 自動の投稿
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="flex flex-wrap items-center gap-x-3 text-[28px] leading-tight font-bold max-sm:text-[24px]">
              {plan.name}
              <PlanStatusMark plan={plan} />
            </h1>
            <p className="num text-[15px] text-faint">{next ? `次は ${formatShort(next.dueAt)}` : plan.status === "active" ? "次の回はまだありません" : "止めています"}</p>
          </div>
          <PlanControls projectId={project.id} planId={plan.id} status={plan.status} nextLabel={next ? formatShort(next.dueAt) : null} />
        </div>
      </div>
      {saved === "1" && <SuccessBanner>直しました。まだ作っていない回から、新しい設定で作ります。</SuccessBanner>}

      <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-3 max-sm:gap-2">
        <Metric label="送った" value={sentRuns.length} unit="回" className="max-sm:px-3" />
        <Metric label="下書きに回した" value={heldCount} unit="回" className="max-sm:px-3" />
        <Metric label="平均の表示" value={avgViews ?? "—"} className="max-sm:px-3" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="回" />
        {runs.length === 0 ? (
          <EmptyState description={next ? `最初の回は ${formatShort(next.dueAt)} です。送る 24 時間前に作ります。` : "まだ回はありません。"} />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} results={r.postId ? (results.get(r.postId) ?? []) : []} projectId={project.id} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="px-6 py-5 max-sm:px-4 max-sm:py-4">
        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-[15px] max-sm:grid-cols-[5rem_1fr]">
          <dt className="text-muted">何を</dt>
          <dd>{KIND_LABELS[plan.kind]}</dd>
          <dt className="text-muted">どこに</dt>
          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {sns.map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <SnsTag sns={s} />
                <span className="text-sm text-muted">{TARGET_MODE_LABELS[plan.targets[s]!]}</span>
              </span>
            ))}
            {plan.targets.x && <span className="text-sm text-muted">X は{plan.xLink === "always" ? "リンクあり" : "リンクなし"}</span>}
          </dd>
          <dt className="text-muted">規則</dt>
          <dd className="num">
            {scheduleText(plan.schedule)} ／ 作るのは {plan.leadHours} 時間前
          </dd>
          {plan.tone && (
            <>
              <dt className="text-muted">口調</dt>
              <dd>{plan.tone}</dd>
            </>
          )}
        </dl>
      </Card>
    </div>
  );
}

function RunRow({ run, results, projectId }: { run: AutoRun; results: RunTargetResult[]; projectId: string }) {
  const published = results.filter((t) => t.status === "published");
  const failed = results.some((t) => t.status === "failed");
  const label = published.length ? "投稿済み" : failed ? "送れなかった" : RUN_STATUS_LABELS[run.status];
  const tone = published.length ? "success" : failed || run.status === "held" || run.status === "review" ? "signal" : "neutral";
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3.5 max-sm:px-4">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num text-[15px] font-bold">{formatShort(run.dueAt)}</span>
          <Badge tone={tone}>{label}</Badge>
        </p>
        {run.reason && (
          <p className="text-[14px] text-muted">
            {RUN_REASON_TEXT[run.reason]}
            {run.reasonDetail && `（${run.reasonDetail}）`}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {published.map((t) => (
          <span key={t.sns} className="num inline-flex items-center gap-1 text-sm text-muted">
            <SnsTag sns={t.sns} />
            {t.views ?? "—"}
          </span>
        ))}
        {run.postId && (
          <Link href={`/projects/${projectId}/posts/${run.postId}`} className="text-sm font-bold underline">
            見る
          </Link>
        )}
      </div>
    </li>
  );
}
