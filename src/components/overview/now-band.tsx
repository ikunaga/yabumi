import Link from "next/link";
import type { ReactNode } from "react";
import { SkipPlanForm } from "@/components/projects/skip-plan-form";
import { ActionBar } from "@/components/ui/action-bar";
import { ButtonLink, NotReadyButton } from "@/components/ui/button";
import { Disclosure, HelpTip } from "@/components/ui/help";
import { dismissGithubPrompt } from "@/lib/github/actions";
import type { CoachView } from "@/lib/coach/load";
import { CYCLE_WEEKS, remainingText, type PaceStatus } from "@/lib/coach/pace";
import { SNS } from "@/lib/sns";
import { DismissableDetails } from "@/components/ui/dismissable-details";
import { STEPS, stepHref } from "@/lib/projects/next-step";
import type { RoadmapItem } from "@/lib/roadmap/load";
import { formatValue, kpiLabel } from "@/lib/roadmap/schema";

// 概要の「いまやること」（1 行とボタンの小さな帯。2026-10-30 オーナーの決定）。上から順に 1 つだけ出す:
// GitHub をつなぐ（任意。設計の前で、飛ばしていなければ）→ 最初の 4 段階 → 1 か月の区切り → 今週のやること（ロードマップ）。
// 伴走（今週の回数）は帯の右に小さく出す。説明は「?」に畳む
export function NowBand({
  projectId,
  stepIndex,
  github,
  coach,
  coachReady,
  todos,
  progress,
  doneCount,
  aiEnabled,
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
}) {
  const base = `/projects/${projectId}`;
  const pace = coach ? <PaceChip projectId={projectId} view={coach} /> : null;

  if (github.show && stepIndex === 0) {
    return (
      <ActionBar
        label="最初に（任意）"
        title="GitHub をつなぐ"
        help={
          <HelpTip label="GitHub をつなぐ理由" align="right">
            アプリのリポジトリをつなぐと、AI がファイルを読んで、アプリの紹介文（どんなアプリか）を下書きします。紹介文は、アカウント設計の相談や投稿のネタの材料になります。非公開でも大丈夫です。
          </HelpTip>
        }
        action={
          <span className="flex items-center gap-3 max-sm:justify-between">
            <form action={dismissGithubPrompt.bind(null, projectId)}>
              <button type="submit" className="text-sm text-muted hover:text-fg hover:underline">
                今はしない
              </button>
            </form>
            {github.configured ? (
              <ButtonLink href={`${base}/github`} size="sm">
                つなぐ
              </ButtonLink>
            ) : (
              <NotReadyButton size="sm">つなぐ</NotReadyButton>
            )}
          </span>
        }
      />
    );
  }

  if (stepIndex < STEPS.length) {
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

  // 最初の 1 か月が終わった: 振り返りと次の 1 か月へ
  if (coach?.cycle?.ended) {
    return (
      <ActionBar
        label="いまやること"
        title="最初の 1 か月が終わりました。振り返って、次の 1 か月の回数を決めましょう"
        help={pace}
        action={
          <ButtonLink href={aiEnabled ? `${base}/consult/new?start=month_review` : `${base}/plan?open=first_month`} size="sm">
            {aiEnabled ? "AI と振り返る" : "次の 1 か月を決める"}
          </ButtonLink>
        }
      />
    );
  }

  const roadmapHref = `${base}/roadmap`;
  const setup = !coach && coachReady ? (
    <Link href={`${base}/plan?open=first_month`} className="shrink-0 text-sm text-muted hover:text-fg hover:underline max-sm:hidden">
      週の回数を決める
    </Link>
  ) : null;
  if (todos.length === 0) {
    return (
      <ActionBar
        label="今週のやること"
        title={doneCount > 0 ? `今週のやることは済みました（${doneCount} 件）` : "今週のやることを決めましょう"}
        help={pace ?? setup}
        action={
          <ButtonLink href={roadmapHref} size="sm" variant={doneCount > 0 ? "secondary" : "primary"}>
            {doneCount > 0 ? "来週を見る" : "決める"}
          </ButtonLink>
        }
      />
    );
  }
  const [first, ...others] = todos;
  return (
    <div className="flex flex-col gap-2">
      <ActionBar
        label={`今週のやること ${todos.length} 件`}
        title={<TodoText item={first} progress={progress[first.id]} />}
        help={pace ?? setup}
        action={
          <ButtonLink href={`${base}/compose?item=${first.id}`} size="sm">
            投稿をつくる
          </ButtonLink>
        }
      />
      {others.length > 0 && (
        <Disclosure summary={`今週のやることの残り ${others.length} 件`} className="px-1">
          <ul className="flex flex-col gap-1">
            {others.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3">
                <Link href={`${base}/compose?item=${t.id}`} className="font-bold text-fg hover:underline">
                  {t.title}
                </Link>
                <TodoText item={t} progress={progress[t.id]} only="progress" />
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
        <span>今週</span>
        <b className="num text-fg">
          {done}/{target} 本
        </b>
        {state && <span className={`font-bold ${state.cls}`}>{state.text}</span>}
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg bg-pop px-4 py-3 text-[13px] leading-[1.7] text-on-pop shadow-pop">
        <p className="font-bold">今週の投稿のペース{cycle && !cycle.ended && `（最初の 1 か月の ${cycle.weekIndex}/${CYCLE_WEEKS} 週目）`}</p>
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
