import Link from "next/link";
import type { ReactNode } from "react";
import { SkipPlanForm } from "@/components/projects/skip-plan-form";
import { ActionBar } from "@/components/ui/action-bar";
import { ButtonLink, NotReadyButton } from "@/components/ui/button";
import { Disclosure, HelpTip } from "@/components/ui/help";
import { dismissGithubPrompt } from "@/lib/github/actions";
import type { CoachView } from "@/lib/coach/load";
import type { GoalReview } from "@/lib/goals/review";
import { CYCLE_WEEKS, remainingText, type PaceStatus } from "@/lib/coach/pace";
import { SNS } from "@/lib/sns";
import { DismissableDetails } from "@/components/ui/dismissable-details";
import { MarkDoneButton } from "./mark-done-button";
import { nowBandKind, STEPS, stepHref, weekTodoPhase } from "@/lib/projects/next-step";
import type { RoadmapItem } from "@/lib/roadmap/load";
import { formatValue, kpiLabel } from "@/lib/roadmap/schema";
import { todoAction } from "@/lib/roadmap/todo-kind";

// 概要の「いまやること」（1 行とボタンの小さな帯。2026-10-30 オーナーの決定）。いつも 1 つ出す（next-step.ts の nowBandKind）:
// 最初の 4 段階 → 目標の振り返り（KGI の期限・届いた）→ 1 か月の区切り → 今週のやること（ロードマップ）。GitHub をつなぐ（任意）は帯の下の小さな 1 行。
// 伴走（今週の投稿の本数）は帯の下の小さな 1 行に出す。説明は押すと開く欄に畳む。
// 前は帯の右（やることの題名の横）にあり、「今週 5/5 本 ✓ 達成」が別のやること（プロフィールに置くなど）の達成に見えた（2026-11-12 PMO の通しテスト）
// いまやることの帯（いつも出す）と、その下の伴走の 1 行・GitHub をつなぐ（任意。つないでいない・飛ばしていないときだけの小さな 1 行）
export function NowBand(props: Parameters<typeof MainBand>[0]) {
  const { projectId, github, coach, coachReady } = props;
  const kind = nowBandKind({ stepIndex: props.stepIndex, cycleEnded: Boolean(coach?.cycle?.ended), goalReview: Boolean(props.goalReview), cycleMerged: props.cycleMerged });
  return (
    <div className="flex flex-col gap-2">
      <MainBand {...props} />
      {kind !== "step" && (coach || coachReady) && <PaceLine projectId={projectId} coach={coach} />}
      {github.show && <GithubLine projectId={projectId} configured={github.configured} />}
    </div>
  );
}

// 伴走の 1 行: 今週の投稿の本数（押すと SNS ごと）。週の回数を決めていなければ、決める入口
function PaceLine({ projectId, coach }: { projectId: string; coach: CoachView | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm text-muted">
      {coach ? (
        <PaceChip projectId={projectId} view={coach} />
      ) : (
        <Link href={`/projects/${projectId}/plan?open=first_month`} className="hover:text-fg hover:underline">
          投稿のペース: 週の回数を決める
        </Link>
      )}
    </div>
  );
}

// GitHub をつなぐ（任意）の 1 行。説明は「?」に畳み、「今はしない」で消える
function GithubLine({ projectId, configured }: { projectId: string; configured: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm text-muted">
      <span>任意: GitHub をつなぐと、AI が紹介文を下書きします</span>
      <HelpTip label="GitHub をつなぐ理由">
        作っているアプリや Web のサービスのリポジトリをつなぐと、AI がファイルを読んで紹介文を下書きします。紹介文は、アカウント設計の相談や投稿のネタの材料になります。非公開でも大丈夫です。
      </HelpTip>
      {configured ? (
        <Link href={`/projects/${projectId}/github`} className="font-bold text-fg underline">
          つなぐ
        </Link>
      ) : (
        <span className="text-faint">つなぐ（準備中）</span>
      )}
      <form action={dismissGithubPrompt.bind(null, projectId)}>
        <button type="submit" className="text-sm text-muted underline hover:text-fg">
          今はしない
        </button>
      </form>
    </div>
  );
}

function MainBand({
  projectId,
  stepIndex,
  coach,
  todos,
  progress,
  doneCount,
  aiEnabled,
  goalReview,
  cycleMerged,
}: {
  projectId: string;
  stepIndex: number;
  // GitHub をつなぐ案内（つないでいない・飛ばしていない・設計の前）。configured は GitHub App の設定があるか
  github: { show: boolean; configured: boolean };
  coach: CoachView | null;
  // 週の回数を決める段階か（設計が済み、4 段階が済んだ）
  coachReady: boolean;
  todos: RoadmapItem[];
  progress: Record<string, { actual: number; target: number } | null>;
  doneCount: number;
  aiEnabled: boolean;
  // 目標の振り返り（期限が来た・届いた。lib/goals/review.ts）
  goalReview: GoalReview | null;
  // 1 か月の区切りを目標の振り返りにまとめるか（目標の期限が区切りから 7 日以内）
  cycleMerged: boolean;
}) {
  const base = `/projects/${projectId}`;

  const kind = nowBandKind({ stepIndex, cycleEnded: Boolean(coach?.cycle?.ended), goalReview: Boolean(goalReview), cycleMerged });
  if (kind === "step") {
    const step = STEPS[stepIndex];
    const rest = STEPS.slice(stepIndex + 1);
    return (
      <ActionBar
        label={`いまやること ${stepIndex + 1}/${STEPS.length}`}
        title={step.title}
        help={
          <HelpTip label="いまやること" align="right">
            <p>{step.description}</p>
            {rest.length > 0 && <p className="mt-2 text-on-pop/70">このあと: {rest.map((s) => s.shortTitle).join(" → ")}</p>}
          </HelpTip>
        }
        action={
          <span className="flex items-center gap-3 max-sm:flex-col-reverse max-sm:items-stretch">
            {step.key === "plan" && <SkipPlanForm projectId={projectId} />}
            {step.available ? (
              <ButtonLink href={stepHref(step.key, projectId)} size="sm">
                {step.cta}
              </ButtonLink>
            ) : (
              <NotReadyButton size="sm">{step.cta}</NotReadyButton>
            )}
          </span>
        }
      />
    );
  }

  // 目標（KGI）の期限が来た・届いた: AI と振り返って次の目標へ（AI が使えなければ、ロードマップで終える）
  if (kind === "goal_review" && goalReview) {
    const name = goalReview.goal.statement ?? "";
    return (
      <ActionBar
        label="いまやること"
        title={goalReview.kind === "reached" ? `目標「${name}」に届きました` : `目標「${name}」の期限が来ました`}
        action={
          <ButtonLink href={aiEnabled ? `${base}/consult/new?start=goal_review&goal=${goalReview.goal.id}` : `${base}/roadmap`} size="sm">
            {aiEnabled ? "AI と振り返る" : "ロードマップで終える"}
          </ButtonLink>
        }
      />
    );
  }

  // 1 か月（中間の目標の区切り）が終わった: 振り返りと次の 1 か月へ
  if (kind === "cycle_ended") {
    return (
      <ActionBar
        label="いまやること"
        title="この 1 か月が終わりました。振り返って、次の 1 か月の目標と回数を決めましょう"
        action={
          <ButtonLink href={aiEnabled ? `${base}/consult/new?start=month_review` : `${base}/plan?open=first_month`} size="sm">
            {aiEnabled ? "AI と振り返る" : "次の 1 か月を決める"}
          </ButtonLink>
        }
      />
    );
  }

  const roadmapHref = `${base}/roadmap`;
  // 済んだ・まだ決めていないの分け方は、プロジェクトの一覧の「次にやること」と同じ（weekTodoPhase）
  const phase = weekTodoPhase({ open: todos.length, finished: doneCount });
  if (phase !== "open") {
    return (
      <ActionBar
        label="今週のやること"
        title={phase === "done" ? `今週のやることは済みました（${doneCount} 件）` : "今週のやることを決めましょう"}
        action={
          <ButtonLink href={roadmapHref} size="sm" variant={phase === "done" ? "secondary" : "primary"}>
            {phase === "done" ? "来週を見る" : "決める"}
          </ButtonLink>
        }
      />
    );
  }
  const [first, ...others] = todos;
  // 押したときの行き先は、やることの種類ごと（投稿をつくる・振り返る・プロフィールの案を見る・ロードマップで見る。4.42）
  const actionOf = (t: RoadmapItem) => todoAction(base, t, { aiEnabled });
  const main = actionOf(first);
  return (
    <div className="flex flex-col gap-2">
      <ActionBar
        label={`今週のやること ${todos.length} 件`}
        title={<TodoText item={first} progress={progress[first.id]} />}
        action={
          // 数字で数えないやること（プロフィールに置く・振り返るなど）は、ここで済みにできる。数字のものは届けば自動で済み
          progress[first.id] ? (
            <ButtonLink href={main.href} size="sm">
              {main.label}
            </ButtonLink>
          ) : (
            <span className="flex items-center gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
              <MarkDoneButton projectId={projectId} itemId={first.id} title={first.title} />
              <ButtonLink href={main.href} size="sm">
                {main.label}
              </ButtonLink>
            </span>
          )
        }
      />
      {others.length > 0 && (
        <Disclosure summary={`今週のやることの残り ${others.length} 件`} className="px-1">
          <ul className="flex flex-col gap-1">
            {others.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3">
                <Link href={actionOf(t).href} className="font-bold text-fg hover:underline">
                  {t.title}
                </Link>
                {actionOf(t).kind !== "post" && <span className="text-xs text-muted">{actionOf(t).label}</span>}
                <TodoText item={t} progress={progress[t.id]} only="progress" />
                {!progress[t.id] && <MarkDoneButton projectId={projectId} itemId={t.id} title={t.title} variant="link" />}
              </li>
            ))}
            <li>
              <Link href={roadmapHref} className="text-sm hover:underline">
                ロードマップを見る
              </Link>
            </li>
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

function TodoText({ item, progress, only }: { item: RoadmapItem; progress: { actual: number; target: number } | null | undefined; only?: "progress" }): ReactNode {
  const p =
    item.kpi && progress ? (
      <span className="num ml-2 text-xs font-normal text-muted">
        {kpiLabel(item.kpi, item.sns)} {formatValue(item.kpi, progress.actual)} / {formatValue(item.kpi, progress.target)}
      </span>
    ) : null;
  if (only === "progress") return p;
  return (
    <>
      {item.title}
      {p}
    </>
  );
}

// 伴走: 今週の回数（送った本数 / 目標）。押すと SNS ごとの回数と、続けた週が出る（4.27）
const PACE_STATUS: Record<PaceStatus, { text: string; className: string }> = {
  done: { text: "✓ 届きました", className: "font-bold text-success" },
  on_track: { text: "予約で届きます", className: "" },
  behind: { text: "● 遅れそう", className: "font-bold text-signal" },
  not_yet: { text: "これから", className: "opacity-70" },
  missed: { text: "届かなかった", className: "opacity-70" },
};

function PaceChip({ projectId, view }: { projectId: string; view: CoachView }) {
  const { week, streak, cycle } = view;
  // 目標を超えた SNS の分は数えない（ほかの SNS の足りない分が見えなくなるため）
  const done = week.rows.reduce((n, r) => n + Math.min(r.published, r.target), 0);
  const target = week.rows.reduce((n, r) => n + r.target, 0);
  const behind = week.rows.some((r) => r.status === "behind");
  const state = week.achieved
    ? { text: "✓ 達成", cls: "text-success" }
    : week.covered
      ? { text: "予約で届きます", cls: "text-muted" }
      : behind
        ? { text: "● 遅れそう", cls: "text-signal" }
        : null;
  return (
    <DismissableDetails className="relative shrink-0">
      <summary className="flex cursor-pointer list-none items-baseline gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-input hover:text-fg [&::-webkit-details-marker]:hidden">
        <span>投稿のペース 今週</span>
        <b className="num text-fg">
          {done}/{target} 本
        </b>
        {state && <span className={`font-bold ${state.cls}`}>{state.text}</span>}
      </summary>
      <div className="absolute left-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg bg-pop px-4 py-3 text-[13px] leading-[1.7] text-on-pop shadow-pop">
        <p className="font-bold">今週の投稿のペース{cycle && !cycle.ended && `（この 1 か月の ${cycle.weekIndex}/${CYCLE_WEEKS} 週目）`}</p>
        {!week.achieved && !week.covered && <p>今週あと {remainingText(week)}</p>}
        <ul className="mt-1">
          {week.rows.map((r) => (
            <li key={r.sns} className="flex items-baseline gap-2">
              <b>{SNS[r.sns].label}</b>
              <span className="num">
                {r.published}/{r.target} 本{r.scheduled > 0 && `（予約 ${r.scheduled}）`}
              </span>
              <span className={`text-xs ${PACE_STATUS[r.status].className}`}>{PACE_STATUS[r.status].text}</span>
            </li>
          ))}
        </ul>
        {streak > 0 && <p className="mt-1">続けた週: {streak} 週</p>}
        <p className="mt-2 text-xs opacity-80">送った投稿と予約した投稿を数えます（週は月曜から）。遅れそうなときと毎週月曜に、メールでもお知らせします。</p>
        <p className="mt-2 flex gap-4 text-xs">
          <Link href={`/projects/${projectId}/plan?open=first_month`} className="font-bold text-on-pop underline">
            週の回数を変える
          </Link>
          <Link href="/settings/notifications" className="text-on-pop underline">
            お知らせの設定
          </Link>
        </p>
      </div>
    </DismissableDetails>
  );
}
