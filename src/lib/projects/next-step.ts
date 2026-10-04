// プロジェクトごとの「いまやること」。最初の 3 段階を順に案内する（設計 → つなぐ → 最初の投稿。要求 F15、決定 D12）
export type StepKey = "plan" | "connect" | "firstPost";

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
];

// 設計が済んでいない（飛ばしてもいない）なら 1 段目、SNS をつないでいなければ 2 段目、つないでいれば 3 段目。
// 設計は「あとで設計する」で飛ばせる。済みの基準は docs/requirements.md の F15
export function currentStepIndex(state: { planDone: boolean; connectedSnsCount: number }): number {
  if (!state.planDone) return 0;
  return state.connectedSnsCount > 0 ? 2 : 1;
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
  }
}
