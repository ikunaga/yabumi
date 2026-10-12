import { z } from "zod";
import { SECTION_KEYS, type SectionKey, type SectionValue } from "@/lib/plan/schema";
import { kgiSchema, kpiTargetsSchema, itemsProposalSchema, type Kgi, type KpiTarget } from "@/lib/roadmap/schema";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { toSectionValue, toWireValue, valueSchemas } from "./plan-coach-schema";

// AI と相談（F09、docs/architecture.md の 4.23）の 1 回の返事の形。構造化出力でこの形に固定する。
// 1 回の返事で出す提案は 1 つの項目（kind）だけで、その中に案を 2〜3 個（長所・短所・おすすめと理由）。アカウント設計の相棒（4.9）と同じ考え方
// （オーナーの指摘、2026-10-12: 種類の違う提案が 1 つの返事に並ぶと、1 つを採用したところで次の話に進み、残りが流れた）。
// 案の中身は種類ごとに形が違うので、スキーマに並べず JSON 文字列（value_json）で受け取り、サーバーで検証する（4.9 と同じ理由。スキーマが大きいと 400 になる）

export const PROPOSAL_KINDS = ["plan_section", "kgi", "kpi_targets", "roadmap_items", "post_draft"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const MAX_OPTIONS = 3;
export const MAX_DRAFT_LENGTH = 5000;

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
});

// 案の中身（検証したあと）
export type ActionBody =
  | { kind: "plan_section"; section: SectionKey; value: SectionValue<SectionKey> }
  | { kind: "kgi"; kgi: Kgi }
  | { kind: "kpi_targets"; kpiTargets: KpiTarget[] }
  // 前の形（2026-10-12 まで）: KGI と KPI の週の目標を 1 つの提案で
  | { kind: "goal"; kgi: Kgi; kpiTargets: KpiTarget[] }
  | {
      kind: "roadmap_items";
      items: { title: string; detail: string; week: number; kpi: KpiTarget["kpi"] | null; target: number | null }[];
    }
  | { kind: "post_draft"; sns: SnsKey | null; text: string };
export type ActionKind = ActionBody["kind"];

export type ConsultOption = ActionBody & { title: string; summary: string; pros: string[]; cons: string[] };
export type ConsultProposal = { kind: ProposalKind; options: ConsultOption[]; recommended: number; reason: string };

// 前の形（2026-10-12 まで）の提案。1 つの返事に種類の違う提案が 0〜3 個、それぞれ案は 1 つ。保存してある会話を読むためだけに残す
export type LegacyConsultAction = ActionBody & { title: string; reason: string };

export type ConsultTurn = { message: string; choices: string[]; proposal: ConsultProposal | null; actions?: LegacyConsultAction[] };

// 採用できる案（新しい形は proposal の案、前の形は actions）。index は採用のときに送る番号
export function adoptableOptions(t: ConsultTurn): (ActionBody & { title: string })[] {
  return t.proposal ? t.proposal.options : (t.actions ?? []);
}

const planSectionSchema = z.object({ section: z.enum(SECTION_KEYS as [SectionKey, ...SectionKey[]]), value: z.unknown() });
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
    case "kgi": {
      const p = z.object({ kgi: kgiSchema }).safeParse(json);
      if (!p.success) return { body: null, problem: `形が正しくありません（${issues(p.error)}）` };
      return { body: { kind, kgi: p.data.kgi }, problem: null };
    }
    case "kpi_targets": {
      const p = z.object({ kpi_targets: kpiTargetsSchema.refine((l) => l.length > 0, "1 つ以上入れてください") }).safeParse(json);
      if (!p.success) return { body: null, problem: `形が正しくありません（${issues(p.error)}）` };
      return { body: { kind, kpiTargets: p.data.kpi_targets }, problem: null };
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
  }
}

// AI の返事を検証する。proposalProblem: 提案はあったのに、案が形に合わなかったときの理由（1 回だけ言い直させる）
export function normalizeConsultTurn(raw: unknown): (ConsultTurn & { proposalProblem: string | null }) | null {
  const parsed = consultTurnSchema.safeParse(raw);
  if (!parsed.success) return null;
  const base = {
    message: parsed.data.message.trim(),
    choices: parsed.data.choices.map((c) => c.trim()).filter(Boolean).slice(0, 4),
  };
  const p = parsed.data.proposal;
  if (!p) return { ...base, proposal: null, proposalProblem: null };

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

// 保存してある返事を、AI に履歴として渡す形（構造化出力と同じ形）に戻す。前の形の返事は、提案を文で添える
export function toWireConsultTurn(t: ConsultTurn): unknown {
  if (!t.proposal) {
    const legacy = t.actions ?? [];
    return {
      message: legacy.length ? `${t.message}\n（このときの提案: ${legacy.map((a) => `${a.title}（${a.kind}）`).join("、")}）` : t.message,
      choices: t.choices,
      proposal: null,
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
  }
}

// ===== ロードマップづくりの順番（入口が「ロードマップ」の会話） =====
// ① KGI → ② KPI と週の目標 → ③ 今週・来週のやること → ④ その先の週。済んだ項目は飛ばす（今のロードマップを読んで決める）
export const ROADMAP_STEPS = [
  { key: "kgi", label: "最終の目標" },
  { key: "kpi_targets", label: "毎週の目標" },
  { key: "near_items", label: "今週・来週のやること" },
  { key: "later_items", label: "その先のやること" },
] as const;
export type RoadmapStepKey = (typeof ROADMAP_STEPS)[number]["key"];

export type RoadmapStepState = { done: Record<RoadmapStepKey, boolean>; next: RoadmapStepKey | null };

export function roadmapStepState(r: { hasKgi: boolean; hasKpiTargets: boolean; itemWeeks: number[] }): RoadmapStepState {
  const done: Record<RoadmapStepKey, boolean> = {
    kgi: r.hasKgi,
    kpi_targets: r.hasKpiTargets,
    near_items: r.itemWeeks.some((w) => w === 0 || w === 1),
    later_items: r.itemWeeks.some((w) => w >= 2),
  };
  return { done, next: ROADMAP_STEPS.find((s) => !done[s.key])?.key ?? null };
}

// 案がロードマップづくりのどの段か（画面の「2 / 4 毎週の目標」）。ロードマップの案でなければ null
export function roadmapStepOf(p: ConsultProposal): RoadmapStepKey | null {
  if (p.kind === "kgi" || p.kind === "kpi_targets") return p.kind;
  if (p.kind === "roadmap_items") return p.options.every((o) => o.kind === "roadmap_items" && o.items.every((i) => i.week <= 1)) ? "near_items" : "later_items";
  return null;
}
