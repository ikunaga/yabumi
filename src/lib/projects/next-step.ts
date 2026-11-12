import { projectSettingsHref } from "./paths";

// プロジェクトごとの「いまやること」。最初の 4 段階を順に案内する（設計 → つなぐ → 最初の投稿 → 目標とロードマップ。要求 F15・F10、決定 D12）。
// 4 段階が済んだら、概要は「いまやること」の代わりに「今週のやること」（ロードマップ）を出す（docs/architecture.md の 4.23）
export type StepKey = "plan" | "connect" | "firstPost" | "roadmap";

export type Step = {
  key: StepKey;
  title: string;
  shortTitle: string;
  description: string;
  cta: string;
  // まだ作っていない機能は false。押せない状態で「準備中」と出す
  available: boolean;
};

export const STEPS: Step[] = [
  {
    key: "plan",
    title: "アカウントを設計する",
    shortTitle: "アカウントを設計する",
    description: "誰に・何のために・どんな名前で・どんな投稿をするかを先に決めます。あとからいつでも直せます。",
    cta: "設計する",
    available: true,
  },
  {
    key: "connect",
    title: "投稿先の SNS をつなぐ",
    shortTitle: "SNS をつなぐ",
    description: "まずは 1 つで大丈夫です。迷ったら X（旧 Twitter）がおすすめ。",
    cta: "つなぐ",
    available: true,
  },
  {
    key: "firstPost",
    title: "最初の投稿をつくる",
    shortTitle: "最初の投稿をつくる",
    description: "自分で書くか、AI とネタを出してから書くかを選べます。つないだ SNS ごとに文面と送る日時を決めます。",
    cta: "投稿をつくる",
    available: true,
  },
  {
    key: "roadmap",
    title: "目標とロードマップを決める",
    shortTitle: "目標とロードマップ",
    description: "最終の目標と、そこへ向かう週ごとのやることを決めます。AI と相談しながら決められます。",
    cta: "決める",
    available: true,
  },
];

// 設計が済んでいない（飛ばしてもいない）なら 1 段目、SNS をつないでいなければ 2 段目、まだ 1 本も送っていなければ 3 段目、
// ロードマップ（目標かやること）がなければ 4 段目。すべて済んだら STEPS.length（概要は「今週のやること」を出す）。
// 設計は「あとで設計する」で飛ばせる。済みの基準は docs/requirements.md の F15
export type StepState = { planDone: boolean; connectedSnsCount: number; hasPublished: boolean; hasRoadmap: boolean };

export function currentStepIndex(state: StepState): number {
  if (!state.planDone) return 0;
  if (state.connectedSnsCount === 0) return 1;
  if (!state.hasPublished) return 2;
  if (!state.hasRoadmap) return 3;
  return STEPS.length;
}

// 各段階のボタンの行き先
export function stepHref(key: StepKey, projectId: string): string {
  switch (key) {
    case "plan":
      return `/projects/${projectId}/plan`;
    case "connect":
      return projectSettingsHref(projectId, "sns");
    case "firstPost":
      return `/projects/${projectId}/compose`;
    case "roadmap":
      return `/projects/${projectId}/roadmap`;
  }
}

// 今週のやることの数（まだ・済み）。一覧は DB の project_step_flags、概要は roadmap/load.ts の thisWeekCounts から。
// 決め方は同じ（tests/todo-achieved.integration.test.ts で突き合わせる）。済みは手で済みにしたもの＋数字で達成したもの。やらないは数えない
export type WeekTodoCounts = { open: number; finished: number };

// 今週のやることの段階。まだのものがある（open）・全部済んだ（done）・まだ決めていない（none）。一覧と概要の帯はどちらもここで分ける
// （2026-11-12 オーナーの指摘「今週のやることおわってるのにプロジェクト一覧に反映されない」: 一覧は済んだ週も「今週のやることを見る」だった）
export type WeekTodoPhase = "open" | "done" | "none";
export function weekTodoPhase(c: WeekTodoCounts): WeekTodoPhase {
  if (c.open > 0) return "open";
  return c.finished > 0 ? "done" : "none";
}

// プロジェクト一覧の「次にやること」。4 段階のうちまだのものがあればその段階、すべて済んだら今週のやること（まだの数・済み・決める）。
// どれも概要（いまやること・今週のやること）へ
export function listNextStep(state: StepState & { thisWeek: WeekTodoCounts }): { label: string; stepIndex: number } {
  const stepIndex = currentStepIndex(state);
  if (stepIndex < STEPS.length) return { label: STEPS[stepIndex].shortTitle, stepIndex };
  const label = { open: `今週のやること あと ${state.thisWeek.open} 件`, done: "✓ 今週のやることは済みました", none: "今週のやることを決める" }[weekTodoPhase(state.thisWeek)];
  return { label, stepIndex };
}

// 概要の「いまやること」の帯に出すもの（いつも 1 つ出す。上から順に）。GitHub をつなぐ（任意）は帯の代わりにはせず、帯の下の小さな 1 行にする
// （2026-10-30 通し確認: 新しい利用者に「GitHub をつなぐ」だけが出て、「アカウントを設計する」が見えなかった）
// 目標の振り返り（goal_review: KGI の期限が来た・届いた）は 1 か月の区切り（cycle_ended）より先。
// 区切りと目標の期限が 7 日以内に重なるときは、目標の振り返りにまとめる（cycleMergedIntoGoal。docs/design/goals-model.md の 5.）
export type NowBandKind = "step" | "goal_review" | "cycle_ended" | "this_week";

export function nowBandKind(state: { stepIndex: number; cycleEnded: boolean; goalReview?: boolean; cycleMerged?: boolean }): NowBandKind {
  if (state.stepIndex < STEPS.length) return "step";
  if (state.goalReview) return "goal_review";
  if (state.cycleEnded && !state.cycleMerged) return "cycle_ended";
  return "this_week";
}
