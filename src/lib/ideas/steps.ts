// 「投稿のネタを出す」画面の 3 つのステップ（① 材料を選ぶ → ② 中身を入れる → ③ ネタを選んで下書きにする。オーナーの決定）
export type IdeaStep = 1 | 2 | 3;

export const IDEA_STEPS: { key: IdeaStep; label: string }[] = [
  { key: 1, label: "材料" },
  { key: 2, label: "中身" },
  { key: 3, label: "ネタ" },
];

// 始めるステップ: ネタ帳の画面でメモを選んできた → ②（材料はネタ帳）、前に出したネタがある → ③、ほか → ①
export function initialIdeaStep({ hasThread, fromNotes }: { hasThread: boolean; fromNotes: boolean }): IdeaStep {
  if (fromNotes) return 2;
  return hasThread ? 3 : 1;
}

// 印から移れるステップ: ①・② はいつでも（② で入れたものは残る）、③ はネタを出したあとだけ
export function canGoIdeaStep(step: IdeaStep, hasThread: boolean): boolean {
  return step !== 3 || hasThread;
}

// 表に出すステップ: ③ にいてもネタがなければ（会話を消したあとなど）① にする
export function visibleIdeaStep(step: IdeaStep, hasThread: boolean): IdeaStep {
  return step === 3 && !hasThread ? 1 : step;
}
