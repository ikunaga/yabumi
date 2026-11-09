import { z } from "zod";
import { SECTION_KEYS, type SectionKey, type SectionValue } from "@/lib/plan/schema";
import { itemsProposalSchema, type Kgi, type KpiTarget } from "@/lib/roadmap/schema";
import type { TodoKind } from "@/lib/roadmap/todo-kind";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { toSectionValue, toWireValue, valueSchemas } from "./plan-coach-schema";
import { goalWireValue, parseGoalProposal, type GoalActionBody } from "./consult-goals";

// AI と相談（F09、docs/architecture.md の 4.23）の 1 回の返事の形。構造化出力でこの形に固定する。
// 1 回の返事で出す提案は 1 つの項目（kind）だけで、その中に案を 2〜3 個（長所・短所・おすすめと理由）。アカウント設計の相棒（4.9）と同じ考え方
// （オーナーの指摘、2026-10-12: 種類の違う提案が 1 つの返事に並ぶと、1 つを採用したところで次の話に進み、残りが流れた）。
// 案の中身は種類ごとに形が違うので、スキーマに並べず JSON 文字列（value_json）で受け取り、サーバーで検証する（4.9 と同じ理由。スキーマが大きいと 400 になる）

// kgi・kpi_targets・action_targets・milestone・revise_goal は目標（docs/design/goals-model.md の 6.。案の中身は consult-goals.ts）
export const PROPOSAL_KINDS = ["plan_section", "kgi", "kpi_targets", "action_targets", "milestone", "revise_goal", "roadmap_items", "post_draft"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const MAX_OPTIONS = 3;
export const MAX_DRAFT_LENGTH = 5000;
// 会話を区切ったときのまとめ（相談の一覧に 1 行で出す）。DB の ai_threads.summary の上限（500）より短く
export const MAX_SUMMARY_LENGTH = 200;

export const consultTurnSchema = z.object({
  message: z.string().describe("利用者に話しかける文。結論と次の一手を先に、理由は短く。用語は使ったら一言で説明する"),
  choices: z.array(z.string()).describe("答えやすい選択肢（0〜4 個）。押すとそのまま利用者の発言になる"),
  proposal: z
    .object({
      kind: z.enum(PROPOSAL_KINDS).describe("提案する項目の種類。1 回の返事で 1 つだけ"),
      options: z
        .array(
          z.object({
            title: z.string().describe("案の短い名前"),
            summary: z.string().describe("どんな案か、1〜2 文"),
            pros: z.array(z.string()).describe("長所"),
            cons: z.array(z.string()).describe("短所"),
            value_json: z.string().describe("案の中身。システムプロンプトの「提案の中身の形」に合う JSON を文字列にしたもの"),
          }),
        )
        .describe("同じ項目についての 2〜3 個の案"),
      recommended: z.number().int().describe("おすすめの案の番号（0 から数える）"),
      reason: z.string().describe("おすすめする理由。相手の設計・数字・答えに結びつけて書く"),
    })
    .nullable()
    .describe("採用できる提案。話の流れで本当に役立つときだけ。なければ null"),
  wrap_up: z
    .object({ summary: z.string().describe("この会話で決まったことの 1 行のまとめ（60 字くらいまで）。相談の一覧に出る") })
    .nullable()
    .describe("会話のゴールに着いて区切るときだけ。choices は空、proposal は null にする。区切らないときは null"),
});

// 案の中身（検証したあと）
export type ActionBody =
  | { kind: "plan_section"; section: SectionKey; value: SectionValue<SectionKey> }
  | GoalActionBody
  // 前の形（2026-11-06 まで。roadmaps の KGI と KPI の週の目標）。保存してある会話を読むためだけに残す（採用はできない）
  | { kind: "kgi"; kgi: Kgi }
  | { kind: "kpi_targets"; kpiTargets: KpiTarget[] }
  // 前の形（2026-10-12 まで）: KGI と KPI の週の目標を 1 つの提案で
  | { kind: "goal"; kgi: Kgi; kpiTargets: KpiTarget[] }
  | {
      kind: "roadmap_items";
      // sns: 前の形で保存した提案にはない（すべての SNS として読む）。kind も 2026-11-03 より前の提案にはない（保存するときに推す）
      items: { title: string; detail: string; week: number; kpi: KpiTarget["kpi"] | null; target: number | null; sns?: SnsKey | null; kind?: TodoKind | null }[];
    }
  // style: 直しても残った、日本語の決まりに反する言い回し（japanese-style.ts。画面に出す）
  | { kind: "post_draft"; sns: SnsKey | null; text: string; style?: string[] };
export type ActionKind = ActionBody["kind"];

export type ConsultOption = ActionBody & { title: string; summary: string; pros: string[]; cons: string[] };
export type ConsultProposal = { kind: ProposalKind; options: ConsultOption[]; recommended: number; reason: string };

// 前の形（2026-10-12 まで）の提案。1 つの返事に種類の違う提案が 0〜3 個、それぞれ案は 1 つ。保存してある会話を読むためだけに残す
export type LegacyConsultAction = ActionBody & { title: string; reason: string };

// wrapUp: AI が会話を区切った（ゴールに着いた）ときのまとめ。2026-11-03 より前の返事にはない
export type ConsultTurn = { message: string; choices: string[]; proposal: ConsultProposal | null; wrapUp?: { summary: string } | null; actions?: LegacyConsultAction[] };

// 採用できる案（新しい形は proposal の案、前の形は actions）。index は採用のときに送る番号
export function adoptableOptions(t: ConsultTurn): (ActionBody & { title: string })[] {
  return t.proposal ? t.proposal.options : (t.actions ?? []);
}

// 相談の AI が直せるセクション。あなたらしさは、投稿に使ってよい項目しか渡していないので直させない（案を採用するとセクション全体が置き換わり、渡していない項目が消えるため。4.50）
export const CONSULT_SECTION_KEYS = SECTION_KEYS.filter((k) => k !== "story") as [SectionKey, ...SectionKey[]];
const planSectionSchema = z.object({ section: z.enum(CONSULT_SECTION_KEYS), value: z.unknown() });
const postDraftSchema = z.object({
  sns: z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]]).nullable().default(null),
  text: z.string().trim().min(1).max(MAX_DRAFT_LENGTH),
});

function parseBody(kind: ProposalKind, value_json: string): { body: ActionBody | null; problem: string | null } {
  let json: unknown;
  try {
    json = JSON.parse(value_json);
  } catch {
    return { body: null, problem: "value_json が JSON として読めません" };
  }
  const issues = (e: z.ZodError) => e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("、");
  const goal = parseGoalProposal(kind, json);
  if (goal) return goal;
  switch (kind) {
    case "plan_section": {
      const p = planSectionSchema.safeParse(json);
      if (!p.success) return { body: null, problem: `形が正しくありません（${issues(p.error)}）` };
      const v = valueSchemas[p.data.section].safeParse(p.data.value);
      if (!v.success) return { body: null, problem: `value が ${p.data.section} の形に合いません（${issues(v.error)}）` };
      const value = toSectionValue(p.data.section, v.data);
      if (!value) return { body: null, problem: "値が長すぎるか、範囲外です" };
      return { body: { kind, section: p.data.section, value }, problem: null };
    }
    case "roadmap_items": {
      const p = itemsProposalSchema.safeParse(json);
      if (!p.success) return { body: null, problem: `形が正しくありません（${issues(p.error)}）` };
      const bad = p.data.items.find((i) => (i.kpi === null) !== (i.target === null));
      if (bad) return { body: null, problem: `「${bad.title}」は kpi と target を両方入れるか、両方 null にしてください` };
      return { body: { kind, items: p.data.items }, problem: null };
    }
    case "post_draft": {
      const p = postDraftSchema.safeParse(json);
      if (!p.success) return { body: null, problem: `形が正しくありません（${issues(p.error)}）` };
      return { body: { kind, sns: p.data.sns, text: p.data.text }, problem: null };
    }
    default:
      return { body: null, problem: `知らない種類です（${kind}）` };
  }
}

// AI の返事を検証する。proposalProblem: 提案はあったのに、案が形に合わなかったときの理由（1 回だけ言い直させる）
export function normalizeConsultTurn(raw: unknown): (ConsultTurn & { proposalProblem: string | null }) | null {
  // wrap_up がない返事（言い直しの前の形など）は、区切らない返事として読む
  const parsed = consultTurnSchema.safeParse(raw && typeof raw === "object" && !("wrap_up" in raw) ? { ...raw, wrap_up: null } : raw);
  if (!parsed.success) return null;
  const base = {
    message: parsed.data.message.trim(),
    choices: parsed.data.choices.map((c) => c.trim()).filter(Boolean).slice(0, 4),
  };
  const p = parsed.data.proposal;
  // 区切るときは、新しい質問（choices）を出さない。案が出ているときは、まだ決めることが残っているので区切らない
  const summary = parsed.data.wrap_up ? clipSummary(parsed.data.wrap_up.summary) : null;
  if (!p) return summary !== null ? { ...base, choices: [], proposal: null, wrapUp: { summary }, proposalProblem: null } : { ...base, proposal: null, proposalProblem: null };

  const options: ConsultOption[] = [];
  const problems: string[] = [];
  for (const [i, o] of p.options.slice(0, MAX_OPTIONS).entries()) {
    const { body, problem } = parseBody(p.kind, o.value_json);
    if (!body) {
      problems.push(`案 ${i + 1}: ${problem}`);
      continue;
    }
    // アカウント設計の直しは、案がみな同じセクションのこと（1 回 1 項目）
    const first = options[0];
    if (body.kind === "plan_section" && first?.kind === "plan_section" && first.section !== body.section) {
      problems.push(`案 ${i + 1}: 1 回の提案は 1 つのセクションだけです（${first.section} と ${body.section} が混ざっています）`);
      continue;
    }
    // 「期限まで続ける」は、ほかの案（次の目標）と並べて 1 つだけ
    if (body.kind === "goal_keep" && options.some((o) => o.kind === "goal_keep")) {
      problems.push(`案 ${i + 1}: 「期限まで続ける」（keep）は 1 つだけにしてください`);
      continue;
    }
    options.push({ ...body, title: o.title.trim() || `案 ${i + 1}`, summary: o.summary.trim(), pros: o.pros, cons: o.cons });
  }
  if (options.length === 0) return { ...base, proposal: null, proposalProblem: problems.join(" / ") || "案がありません" };
  return {
    ...base,
    proposal: { kind: p.kind, options, recommended: p.recommended >= 0 && p.recommended < options.length ? p.recommended : 0, reason: p.reason.trim() },
    // 一部の案だけが形に合わなかったときも言い直させる（案が 1 つだけになるのを避ける）。言い直しも合わなければ、合った案だけで出す
    proposalProblem: problems.length ? problems.join(" / ") : null,
  };
}

function clipSummary(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_SUMMARY_LENGTH ? `${t.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : t;
}

// 保存してある返事を、AI に履歴として渡す形（構造化出力と同じ形）に戻す。前の形の返事は、提案を文で添える
export function toWireConsultTurn(t: ConsultTurn): unknown {
  if (!t.proposal) {
    const legacy = t.actions ?? [];
    return {
      message: legacy.length ? `${t.message}\n（このときの提案: ${legacy.map((a) => `${a.title}（${a.kind}）`).join("、")}）` : t.message,
      choices: t.choices,
      proposal: null,
      wrap_up: t.wrapUp ? { summary: t.wrapUp.summary } : null,
    };
  }
  const p = t.proposal;
  return {
    message: t.message,
    choices: t.choices,
    proposal: {
      kind: p.kind,
      options: p.options.map((o) => ({ title: o.title, summary: o.summary, pros: o.pros, cons: o.cons, value_json: JSON.stringify(wireValue(o)) })),
      recommended: p.recommended,
      reason: p.reason,
    },
    wrap_up: null,
  };
}

function wireValue(a: ActionBody): unknown {
  switch (a.kind) {
    case "plan_section":
      return { section: a.section, value: toWireValue(a.section, a.value) };
    case "kgi":
      return { kgi: a.kgi };
    case "kpi_targets":
      return { kpi_targets: a.kpiTargets };
    case "goal":
      return { kgi: a.kgi, kpi_targets: a.kpiTargets };
    case "roadmap_items":
      return { items: a.items };
    case "post_draft":
      return { sns: a.sns, text: a.text };
    default:
      return goalWireValue(a);
  }
}

// ===== ロードマップづくりの順番（入口が「ロードマップ」の会話） =====
// ① KGI と中間の目標 → ② KPI と週の目標 → ③ 投稿の週の本数（行動の目標）→ ④ 今週・来週のやること → ⑤ その先の週。
// 済んだ項目は飛ばす（いまの目標を読んで決める。docs/design/goals-model.md の 6.）
export const ROADMAP_STEPS = [
  { key: "kgi", label: "最終の目標" },
  { key: "kpi_targets", label: "毎週の目標" },
  { key: "action_targets", label: "投稿の週の本数" },
  { key: "near_items", label: "今週・来週のやること" },
  { key: "later_items", label: "その先のやること" },
] as const;
export type RoadmapStepKey = (typeof ROADMAP_STEPS)[number]["key"];

export type RoadmapStepState = { done: Record<RoadmapStepKey, boolean>; next: RoadmapStepKey | null };

export function roadmapStepState(r: { hasKgi: boolean; hasKpiTargets: boolean; hasActions: boolean; itemWeeks: number[] }): RoadmapStepState {
  const done: Record<RoadmapStepKey, boolean> = {
    kgi: r.hasKgi,
    kpi_targets: r.hasKpiTargets,
    action_targets: r.hasActions,
    near_items: r.itemWeeks.some((w) => w === 0 || w === 1),
    later_items: r.itemWeeks.some((w) => w >= 2),
  };
  return { done, next: ROADMAP_STEPS.find((s) => !done[s.key])?.key ?? null };
}

// 案がロードマップづくりのどの段か（画面の「2 / 4 毎週の目標」）。入口が「ロードマップ」の会話の、ロードマップの案だけ。ほかは null
// （振り返りの次の一手が「ロードマップづくり 3 / 4」と出ていた。2026-11-03）
export function roadmapStepOf(p: ConsultProposal, topic: string | null): RoadmapStepKey | null {
  if (topic !== "roadmap") return null;
  if (p.kind === "kgi" || p.kind === "kpi_targets" || p.kind === "action_targets") return p.kind;
  if (p.kind === "roadmap_items") return p.options.every((o) => o.kind === "roadmap_items" && o.items.every((i) => i.week <= 1)) ? "near_items" : "later_items";
  return null;
}

// 振り返りの会話のゴールの案の見出し。振り返りの次の一手は「来週のやること」、毎月の振り返りは「次の 1 か月の目標と週の本数」、
// 目標の振り返りは「次の目標」。前の形（1 か月の振り返りの first_month）は「次の 1 か月の週の回数」。ほかは null
export function reviewHeadingOf(p: ConsultProposal, topic: string | null): string | null {
  if (topic === "review" && p.kind === "roadmap_items") return "来週のやること";
  if (topic === "month_review" && p.kind === "milestone") return "次の 1 か月の目標と週の本数";
  if (topic === "month_review" && p.kind === "revise_goal") return "目標の見直し";
  if (topic === "goal_review" && p.kind === "kgi") return "次の目標";
  if (topic === "month_review" && p.kind === "plan_section" && p.options.every((o) => o.kind === "plan_section" && o.section === "first_month")) return "次の 1 か月の週の回数";
  return null;
}
