import { z } from "zod";
import {
  MAX_KPIS_PER_GOAL,
  actionListSchema,
  goalInputSchema,
  kpiListSchema,
  milestoneCount,
  type ActionInput,
  type GoalInput,
  type GoalMetric,
  type GoalStatus,
  type KpiInput,
  type OutcomeAction,
} from "@/lib/goals/schema";
import { MAX_WEEKLY_PER_SNS } from "@/lib/plan/schema";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";

// AI と相談の、目標（KGI）・中間の目標・KPI・行動の目標の案（docs/design/goals-model.md の 6.、段階 ③）。
// 案の形の確かめと、「いまの状況」に書く目標の文。画面とサーバーの両方から読むので、サーバー専用のものを import しない

// ===== 名前 =====
const OUTCOME_NOUN: Record<OutcomeAction, string> = { purchase: "購入", signup: "申し込み・登録", booking: "予約", inquiry: "問い合わせ", visit: "来店" };
const METRIC_NAME: Record<GoalMetric, string> = {
  posts: "投稿した回数",
  link_clicks: "行き先へのクリック",
  downloads: "ダウンロード",
  store_page_views: "ストアのページの閲覧",
  revenue: "課金（売上）",
  outcomes: "成果",
  followers: "フォロワーの増え方",
  views: "投稿の閲覧数",
};

export function goalMetricLabel(ref: { metric: GoalMetric | null; action: OutcomeAction | null; sns: SnsKey | null }): string {
  if (!ref.metric) return "（まだ決めていない）";
  const base = ref.metric === "outcomes" && ref.action ? `${OUTCOME_NOUN[ref.action]}（手で記録）` : METRIC_NAME[ref.metric];
  return ref.sns ? `${base}（${SNS[ref.sns].label}）` : base;
}

export function formatGoalValue(metric: GoalMetric | null, v: number): string {
  const n = Math.round(v * 10) / 10;
  return metric === "revenue" ? `${n.toLocaleString("ja-JP")} 円` : n.toLocaleString("ja-JP");
}

// ===== 案の中身（検証したあと） =====
export type GoalActionBody =
  // 最終の目標（KGI）と、4 週ごとの中間の目標。weekly: 次の 1 か月の週の本数もまとめて決めるとき（目標の振り返りで、区切りと期限が重なったとき）
  | { kind: "goal_plan"; goal: GoalInput; milestones: (number | null)[]; weekly: ActionInput[] | null }
  // 目標に届いたとき: 期限まで続ける（何も書き換えない）
  | { kind: "goal_keep" }
  // KPI（KGI に効く途中の数字 1〜3 個。posts は入れない）
  | { kind: "goal_kpis"; kpis: KpiInput[] }
  // 行動の目標（SNS ごとの投稿の週の本数）
  | { kind: "goal_actions"; actions: ActionInput[] }
  // 毎月の振り返り: 次の 4 週の中間の目標と、週の本数（null は変えない）
  | { kind: "next_milestone"; target: number | null; actions: ActionInput[] | null }
  // KGI を見直す（文・目標の値・期限をのばす週の数。null・0 は変えない）
  | { kind: "goal_revise"; statement: string | null; target: number | null; extendWeeks: number };

type Parsed = { body: GoalActionBody | null; problem: string | null };
const bad = (problem: string): Parsed => ({ body: null, problem });
const issues = (e: z.ZodError) => e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("、");

const POSTS_NOT_KGI = "posts（投稿した回数）は KGI にも KPI にもしません。投稿の週の本数は action_targets（行動の目標）で出してください";

// {"x": 2, "instagram": 1} → 行動の目標。知らない SNS・範囲の外は問題にする
function parseWeekly(v: unknown): { actions: ActionInput[] | null; problem: string | null } {
  if (v === null || v === undefined) return { actions: null, problem: null };
  if (typeof v !== "object" || Array.isArray(v)) return { actions: null, problem: "weekly は {\"x\": 2} の形にしてください" };
  const out: ActionInput[] = [];
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (!(SNS_KEYS as string[]).includes(k)) return { actions: null, problem: `weekly の ${k} は SNS の名前ではありません` };
    if (n === 0) continue;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_WEEKLY_PER_SNS) return { actions: null, problem: `weekly の ${k} は 1〜${MAX_WEEKLY_PER_SNS} の整数にしてください` };
    out.push({ sns: k as SnsKey, per_week: n });
  }
  const p = actionListSchema.safeParse(out);
  if (!p.success) return { actions: null, problem: `weekly の形が正しくありません（${issues(p.error)}）` };
  return { actions: SNS_KEYS.flatMap((s) => p.data.filter((a) => a.sns === s)), problem: null };
}

const kgiWire = z.object({
  kgi: z.unknown(),
  milestones: z.array(z.object({ target: z.number().positive().max(10_000_000).nullable() })).default([]),
  weekly: z.unknown().optional(),
});

// proposal.kind ごとの value_json を確かめる（consult-schema.ts の parseBody から呼ぶ）。目標の案でない kind は null
export function parseGoalProposal(kind: string, json: unknown): Parsed | null {
  switch (kind) {
    case "kgi": {
      if (json && typeof json === "object" && (json as { keep?: unknown }).keep === true) return { body: { kind: "goal_keep" }, problem: null };
      const w = kgiWire.safeParse(json);
      if (!w.success) return bad(`形が正しくありません（${issues(w.error)}）`);
      if ((w.data.kgi as { metric?: unknown } | null)?.metric === "posts") return bad(POSTS_NOT_KGI);
      const g = goalInputSchema.safeParse(w.data.kgi);
      if (!g.success) return bad(`kgi の形が正しくありません（${issues(g.error)}）`);
      const count = milestoneCount(g.data.weeks);
      if (w.data.milestones.length !== count) return bad(`milestones は ${count} 個（${g.data.weeks} 週を 4 週ごとに分けた数）にしてください`);
      const weekly = parseWeekly(w.data.weekly);
      if (weekly.problem) return bad(weekly.problem);
      return { body: { kind: "goal_plan", goal: g.data, milestones: w.data.milestones.map((m) => m.target), weekly: weekly.actions }, problem: null };
    }
    case "kpi_targets": {
      const list = (json as { kpis?: unknown } | null)?.kpis;
      if (Array.isArray(list) && list.some((k) => (k as { metric?: unknown })?.metric === "posts")) return bad(POSTS_NOT_KGI);
      const p = z.object({ kpis: kpiListSchema.refine((l) => l.length > 0, `1〜${MAX_KPIS_PER_GOAL} 個にしてください`) }).safeParse(json);
      if (!p.success) return bad(`形が正しくありません（${issues(p.error)}）`);
      const keys = p.data.kpis.map((k) => `${k.metric}:${k.action ?? ""}:${k.sns ?? ""}`);
      if (new Set(keys).size !== keys.length) return bad("同じ数字が 2 つあります");
      return { body: { kind: "goal_kpis", kpis: p.data.kpis }, problem: null };
    }
    case "action_targets": {
      const weekly = parseWeekly((json as { weekly?: unknown } | null)?.weekly);
      if (weekly.problem) return bad(weekly.problem);
      if (!weekly.actions?.length) return bad("weekly に 1 つ以上の SNS の週の本数を入れてください");
      return { body: { kind: "goal_actions", actions: weekly.actions }, problem: null };
    }
    case "milestone": {
      const p = z.object({ target: z.number().positive().max(10_000_000).nullable(), weekly: z.unknown().optional() }).safeParse(json);
      if (!p.success) return bad(`形が正しくありません（${issues(p.error)}）`);
      const weekly = parseWeekly(p.data.weekly);
      if (weekly.problem) return bad(weekly.problem);
      return { body: { kind: "next_milestone", target: p.data.target, actions: weekly.actions?.length ? weekly.actions : null }, problem: null };
    }
    case "revise_goal": {
      const p = z
        .object({
          statement: z.string().trim().min(1).max(120).nullable().default(null),
          target: z.number().positive().max(10_000_000).nullable().default(null),
          extend_weeks: z.number().int().min(0).max(12).default(0),
        })
        .safeParse(json);
      if (!p.success) return bad(`形が正しくありません（${issues(p.error)}）`);
      if (p.data.statement === null && p.data.target === null && p.data.extend_weeks === 0) return bad("statement・target・extend_weeks のどれかを変えてください");
      return { body: { kind: "goal_revise", statement: p.data.statement, target: p.data.target, extendWeeks: p.data.extend_weeks }, problem: null };
    }
    default:
      return null;
  }
}

function weeklyWire(actions: ActionInput[] | null): Record<string, number> | null {
  if (!actions) return null;
  return Object.fromEntries(actions.filter((a) => a.sns).map((a) => [a.sns!, a.per_week]));
}

// 保存してある案を、AI に履歴として渡す形（value_json）に戻す
export function goalWireValue(a: GoalActionBody): unknown {
  switch (a.kind) {
    case "goal_plan":
      return { kgi: a.goal, milestones: a.milestones.map((target) => ({ target })), ...(a.weekly ? { weekly: weeklyWire(a.weekly) } : {}) };
    case "goal_keep":
      return { keep: true };
    case "goal_kpis":
      return { kpis: a.kpis };
    case "goal_actions":
      return { weekly: weeklyWire(a.actions) };
    case "next_milestone":
      return { target: a.target, weekly: weeklyWire(a.actions) };
    case "goal_revise":
      return { statement: a.statement, target: a.target, extend_weeks: a.extendWeeks };
  }
}

// ===== 「いまの状況」の目標の部分 =====
export type GoalContext = {
  active: {
    statement: string | null;
    metric: GoalMetric | null;
    label: string;
    target: number | null;
    startsOn: string;
    endsOn: string | null;
    provisional: boolean;
    // 前の作りから移した、投稿の本数の KGI（成果の目標に変えるよう勧める）
    legacyPosts: boolean;
    progress: { value: number; countedThrough: string | null; available: boolean; projected: number | null; daysLeft: number } | null;
    milestones: { seq: number; startsOn: string; endsOn: string; target: number | null; result: number | null; current: boolean }[];
    current: { value: number; countedThrough: string | null; available: boolean } | null;
    kpis: { label: string; perWeek: number }[];
    actions: { sns: SnsKey | null; perWeek: number }[];
    // 期限が来た・届いた（goalNeedsReview）
    review: "reached" | "ended" | null;
  } | null;
  // これまでの目標（新しい順に 3 つまで）
  past: { statement: string | null; label: string; metric: GoalMetric | null; target: number | null; result: number | null; status: GoalStatus; startsOn: string; endsOn: string | null }[];
  // KGI に使える数字の候補（見た人にしてほしいことの既定と、仮の KGI のクリック）。available: 取り込み元がある / hasData: 直近 12 週に 1 以上
  candidates: { metric: GoalMetric; action: OutcomeAction | null; label: string; available: boolean; hasData: boolean }[];
};

const STATUS_TEXT: Record<GoalStatus, string> = { active: "いまの目標", achieved: "達成", expired: "期限切れ（届かなかった）", replaced: "期限の前に替えた" };

function countedText(p: { value: number; countedThrough: string | null; available: boolean }, metric: GoalMetric | null): string {
  if (!p.available) return "数えていない（取り込み元をつないでいない。推測で語らない）";
  return `${formatGoalValue(metric, p.value)}${p.countedThrough ? `（${p.countedThrough} まで数えた）` : "（まだ数えた日がない）"}`;
}

export function goalContextLines(g: GoalContext): string[] {
  const lines: string[] = ["目標:"];
  const a = g.active;
  if (!a || !a.metric) {
    lines.push("KGI: まだ決めていない");
  } else {
    lines.push(
      `KGI: ${a.statement ?? ""}（${a.label} を ${formatGoalValue(a.metric, a.target ?? 0)}、${a.startsOn}〜${a.endsOn}${a.provisional ? "、仮の KGI（成果の数字を取れるようになったら替える）" : ""}）`,
    );
    if (a.legacyPosts) lines.push("この KGI は投稿の本数（行動の目標）で、成果の目標になっていない。成果の数字の KGI に替えるよう勧める");
    if (a.progress) {
      lines.push(
        `KGI の進み具合: ${countedText(a.progress, a.metric)} / ${formatGoalValue(a.metric, a.target ?? 0)}、残り ${a.progress.daysLeft} 日${a.progress.projected !== null ? `、このままのペースの見込み ${formatGoalValue(a.metric, a.progress.projected)}` : "（見込みはまだ出せない）"}`,
      );
    }
    if (a.review) lines.push(a.review === "reached" ? "KGI に届いた（期限の前）" : "KGI の期限が来た");
  }
  if (a?.milestones.length) {
    lines.push(
      "中間の目標（4 週ごと）:",
      ...a.milestones.map(
        (m) =>
          `- ${m.seq} つ目 ${m.startsOn}〜${m.endsOn}: 目標 ${m.target === null ? "なし" : formatGoalValue(a.metric, m.target)}${m.result !== null ? `、結果 ${formatGoalValue(a.metric, m.result)}` : ""}${m.current ? `（いまの区切り${a.current ? `。いまの数 ${countedText(a.current, a.metric)}` : ""}）` : ""}`,
      ),
    );
  }
  lines.push(a?.kpis.length ? `KPI の週の目標: ${a.kpis.map((k) => `${k.label} 週 ${k.perWeek}`).join("、")}` : "KPI の週の目標: まだ決めていない");
  lines.push(
    a?.actions.length
      ? `行動の目標（投稿の週の本数）: ${a.actions.map((x) => `${x.sns ? SNS[x.sns].label : "すべての SNS"} 週 ${x.perWeek}`).join("、")}`
      : "行動の目標（投稿の週の本数）: まだ決めていない",
  );
  if (g.past.length) {
    lines.push(
      "これまでの目標（新しい順）:",
      ...g.past.map((p) => `- ${p.statement ?? "（KGI なし）"}（${p.label}、${p.startsOn}〜${p.endsOn ?? ""}）: ${STATUS_TEXT[p.status]}${p.target !== null && p.result !== null ? `、結果 ${formatGoalValue(p.metric, p.result)} / ${formatGoalValue(p.metric, p.target)}` : ""}`),
    );
  }
  lines.push(
    "KGI に使える数字の候補:",
    ...g.candidates.map((c) => `- ${c.label}（metric: ${c.metric}${c.action ? `、action: ${c.action}` : ""}）: ${!c.available ? "数えられない（つないでいない）" : c.hasData ? "数えている" : "数えられるが、まだ記録がない"}`),
  );
  return lines;
}
