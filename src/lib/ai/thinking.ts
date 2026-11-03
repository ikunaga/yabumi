// AI を待っている間の表示（src/components/ui/ai-thinking.tsx）の、段階の文と経った時間（docs/architecture.md の 4.51）。
// 段階は本当の進み具合ではなく、経った秒数で切り替える目安（% は出さない）。秒数はおおよその待ち時間に合わせる

export type ThinkingStage = { at: number; text: string };

const LONGER = "もう少しかかっています";

export const THINKING_STAGES = {
  // 会話（相談・設計の相棒）。10〜30 秒
  chat: [
    { at: 0, text: "考えています" },
    { at: 30, text: LONGER },
  ],
  // 投稿に整える。20〜40 秒
  tidy: [
    { at: 0, text: "読み込んでいます" },
    { at: 5, text: "案を考えています" },
    { at: 15, text: "文を整えています" },
    { at: 30, text: LONGER },
  ],
  // ネタ出し（コミット以外の材料）。20〜60 秒
  ideas: [
    { at: 0, text: "材料を読んでいます" },
    { at: 5, text: "ネタを考えています" },
    { at: 20, text: "下書きを書いています" },
    { at: 45, text: LONGER },
  ],
  // ネタ出し（コミット）。30〜90 秒
  ideasCommits: [
    { at: 0, text: "コミットを読んでいます" },
    { at: 15, text: "ネタを考えています" },
    { at: 35, text: "下書きを書いています" },
    { at: 70, text: LONGER },
  ],
  // 画像の文字の案・絵の説明の案・AI の見直し。10〜20 秒
  brief: [
    { at: 0, text: "読み込んでいます" },
    { at: 4, text: "文字の案を考えています" },
    { at: 20, text: LONGER },
  ],
  scene: [
    { at: 0, text: "読み込んでいます" },
    { at: 4, text: "場面の案を考えています" },
    { at: 20, text: LONGER },
  ],
  check: [
    { at: 0, text: "読み込んでいます" },
    { at: 4, text: "気になるところを探しています" },
    { at: 20, text: LONGER },
  ],
  // AI で画像をつくる。1 枚 10〜20 秒
  photo: [
    { at: 0, text: "絵の説明を送っています" },
    { at: 3, text: "画像をつくっています" },
    { at: 25, text: "仕上げています" },
    { at: 50, text: LONGER },
  ],
  // GitHub のリポジトリから紹介文。30〜90 秒
  description: [
    { at: 0, text: "読むファイルを選んでいます" },
    { at: 15, text: "ファイルを読んでいます" },
    { at: 35, text: "紹介文を書いています" },
    { at: 70, text: LONGER },
  ],
  // 答えを受けて出し直す・書き直す
  redo: [
    { at: 0, text: "答えを読んでいます" },
    { at: 5, text: "書き直しています" },
    { at: 40, text: LONGER },
  ],
} as const satisfies Record<string, readonly ThinkingStage[]>;

export type ThinkingKind = keyof typeof THINKING_STAGES;

// 経った秒数のときの段階の文（at が秒数以下の、いちばん後の段階）
export function thinkingStage(stages: readonly ThinkingStage[], seconds: number): string {
  let text = stages[0]?.text ?? "";
  for (const s of stages) if (s.at <= seconds) text = s.text;
  return text;
}

// 「12 秒」「1 分 5 秒」
export function elapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

export function elapsedSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
