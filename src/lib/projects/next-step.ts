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
    description: "下書きを書いて、つないだ SNS ごとに文面と送る日時を決めます。",
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
export function currentStepIndex(state: { planDone: boolean; connectedSnsCount: number; hasPublished?: boolean; hasRoadmap?: boolean }): number {
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
      return `/projects/${projectId}#sns`;
    case "firstPost":
      return `/projects/${projectId}/compose`;
    case "roadmap":
      return `/projects/${projectId}/roadmap`;
  }
}
