import type { SnsKey, TargetIssue } from "@/lib/sns";

// 投稿をつくるのステップ（docs/design/compose-steps.md）。画面から切り離した決まりだけ（テストはここを中心にする）

export const COMPOSE_STEPS = [
  { key: "write", label: "書く", title: "何を伝えるか" },
  { key: "targets", label: "送り先", title: "どこに出すか" },
  { key: "images", label: "画像", title: "画像を添えるか" },
  { key: "links", label: "リンク", title: "行き先へ案内するか" },
  { key: "send", label: "送る", title: "いつ出すか" },
] as const;
export type ComposeStepKey = (typeof COMPOSE_STEPS)[number]["key"];
// 1 から数えたステップの番号
export type StepNo = 1 | 2 | 3 | 4 | 5;
export const LAST_STEP: StepNo = 5;

export const stepNo = (key: ComposeStepKey): StepNo => (COMPOSE_STEPS.findIndex((s) => s.key === key) + 1) as StepNo;
export const stepKey = (n: StepNo): ComposeStepKey => COMPOSE_STEPS[n - 1].key;

// 開いたときのステップ（4.）: 新しい投稿は ①、保存した下書き・一部だけ送った投稿は ⑤ のまとめから。本文が空なら ①
export function startStep(a: { saved: boolean; body: string }): StepNo {
  return a.saved && a.body.trim() !== "" ? 5 : 1;
}

// URL の ?step（範囲の外・数でないものは、開いたときのステップ）
export function parseStep(raw: string | null | undefined, fallback: StepNo): StepNo {
  if (!raw || !/^[1-5]$/.test(raw)) return fallback;
  return Number(raw) as StepNo;
}

// ステップごとの問題（⑤ のまとめと、上の進みの ● の印。「直す」でそのステップへ）
export type StepProblem = { step: StepNo; text: string };

// SNS ごとの確かめ（checkTarget の issues）を、どのステップで直すかに分ける。
// 文面の問題は、SNS ごとの文面があればその SNS の欄（② 送り先）、なければ本文（① 書く）。
// ハッシュタグが多すぎるのは、SNS ごとのタグがあれば ② のタグの欄（本文とタグを合わせて数えるため。4.59）
const ISSUE_STEP: Record<TargetIssue, "text" | ComposeStepKey> = {
  empty: "text",
  too_long: "text",
  too_many_hashtags: "text",
  needs_title: "targets",
  needs_image: "images",
  needs_video: "images",
  bad_aspect_ratio: "images",
  too_many_images: "images",
};

export function problemsByStep(a: {
  issues: { sns: SnsKey; label: string; issues: TargetIssue[]; override: boolean; tags?: boolean; issueLabel: (i: TargetIssue) => string }[];
  // SNS ごとのタグの欄の問題（タグにできない言葉・多すぎる。② で直す）
  tagProblems?: { label: string; text: string }[];
  // X の月の上限に当たる（X を外すか、手で投稿するかを ② で選ぶ）
  xBudget?: string | null;
  noTargets: boolean;
  missingConnect: string[];
  reconnect: string[];
  needsTime: boolean;
}): StepProblem[] {
  const out: StepProblem[] = [];
  if (a.noTargets) out.push({ step: 2, text: "送り先の SNS を選んでください" });
  for (const t of a.issues) {
    for (const issue of t.issues) {
      const k = ISSUE_STEP[issue];
      const step = k === "text" ? (t.override || (issue === "too_many_hashtags" && t.tags) ? 2 : 1) : stepNo(k);
      out.push({ step, text: `${t.label}: ${t.issueLabel(issue)}` });
    }
  }
  for (const p of a.tagProblems ?? []) out.push({ step: 2, text: `${p.label}: ${p.text}` });
  if (a.xBudget) out.push({ step: 2, text: a.xBudget });
  if (a.missingConnect.length) out.push({ step: 2, text: `${a.missingConnect.join("・")} をつなぐと送れます` });
  if (a.reconnect.length) out.push({ step: 3, text: `${a.reconnect.join("・")} に画像を送るには、つなぎ直しが要ります` });
  if (a.needsTime) out.push({ step: 5, text: "送る日時を決めてください" });
  return out.sort((x, y) => x.step - y.step);
}

// 次へ進めるか（2.）。① は本文があること、② は SNS を 1 つ以上（「あとで選ぶ」は別のボタン）。③・④ はいつでも
export function canGoNext(step: StepNo, a: { body: string; chosen: number }): boolean {
  if (step === 1) return a.body.trim() !== "";
  if (step === 2) return a.chosen > 0;
  return step < LAST_STEP;
}

// 上の進みの印: 問題あり（●）・済み（✓。一度通り過ぎたか、中身がある）・まだ
export type StepMark = "problem" | "done" | "todo";
export function stepMarks(a: { current: StepNo; visited: ReadonlySet<StepNo>; problems: StepProblem[]; filled: Partial<Record<StepNo, boolean>> }): Record<StepNo, StepMark> {
  const mark = (n: StepNo): StepMark => {
    // まだ通っていない先のステップの問題は、まだ出さない（新しい投稿で、② を開く前から「送り先を選んで」を出さない）
    if (a.problems.some((p) => p.step === n) && (a.visited.has(n) || n < a.current)) return "problem";
    if (n !== a.current && (a.visited.has(n) || a.filled[n])) return "done";
    return "todo";
  };
  return { 1: mark(1), 2: mark(2), 3: mark(3), 4: mark(4), 5: mark(5) };
}

// 保存で返ってきた欄のエラーがあるステップ（いちばん前のもの）。なければ null
export function fieldErrorStep(fe: { body?: string; targets?: string; media?: string; plannedAt?: string }): StepNo | null {
  if (fe.body) return 1;
  if (fe.targets) return 2;
  if (fe.media) return 3;
  if (fe.plannedAt) return 5;
  return null;
}

// 送れない理由（いまの blocker の文）を、どのステップで直すか。同じ文の問題があれば、そのステップ（引用の投稿など、ステップで直すものでなければ null）
export function blockerStep(blocker: string | null, problems: StepProblem[]): StepNo | null {
  if (!blocker) return null;
  return problems.find((p) => p.text === blocker)?.step ?? null;
}
