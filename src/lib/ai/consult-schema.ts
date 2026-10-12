import { z } from "zod";
import { SECTION_KEYS, type SectionKey, type SectionValue } from "@/lib/plan/schema";
import { goalProposalSchema, itemsProposalSchema, type Kgi, type KpiTarget } from "@/lib/roadmap/schema";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { toSectionValue, toWireValue, valueSchemas } from "./plan-coach-schema";

// AI と相談（F09、docs/architecture.md の 4.23）の 1 回の返事の形。構造化出力でこの形に固定する。
// 提案の中身は種類ごとに形が違うので、スキーマに並べず JSON 文字列（value_json）で受け取り、サーバーで検証する（4.9 と同じ理由）

export const ACTION_KINDS = ["plan_section", "goal", "roadmap_items", "post_draft"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const MAX_ACTIONS = 3;
export const MAX_DRAFT_LENGTH = 5000;

export const consultTurnSchema = z.object({
  message: z.string().describe("利用者に話しかける文。結論と次の一手を先に、理由は短く。用語は使ったら一言で説明する"),
  choices: z.array(z.string()).describe("答えやすい選択肢（0〜4 個）。押すとそのまま利用者の発言になる"),
  actions: z
    .array(
      z.object({
        kind: z.enum(ACTION_KINDS).describe("提案の種類"),
        title: z.string().describe("提案の短い名前（ボタンの横に出す）"),
        reason: z.string().describe("この提案をする理由。1〜2 文"),
        value_json: z.string().describe("提案の中身。システムプロンプトの「提案の中身の形」に合う JSON を文字列にしたもの"),
      }),
    )
    .describe("採用できる提案（0〜3 個）。なければ空"),
});

// 検証したあとの提案
export type ConsultAction =
  | { kind: "plan_section"; title: string; reason: string; section: SectionKey; value: SectionValue<SectionKey> }
  | { kind: "goal"; title: string; reason: string; kgi: Kgi; kpiTargets: KpiTarget[] }
  | {
      kind: "roadmap_items";
      title: string;
      reason: string;
      items: { title: string; detail: string; week: number; kpi: KpiTarget["kpi"] | null; target: number | null }[];
    }
  | { kind: "post_draft"; title: string; reason: string; sns: SnsKey | null; text: string };

export type ConsultTurn = { message: string; choices: string[]; actions: ConsultAction[] };

const planSectionSchema = z.object({ section: z.enum(SECTION_KEYS as [SectionKey, ...SectionKey[]]), value: z.unknown() });
const postDraftSchema = z.object({
  sns: z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]]).nullable().default(null),
  text: z.string().trim().min(1).max(MAX_DRAFT_LENGTH),
});

function parseAction(raw: { kind: ActionKind; title: string; reason: string; value_json: string }): { action: ConsultAction | null; problem: string | null } {
  let json: unknown;
  try {
    json = JSON.parse(raw.value_json);
  } catch {
    return { action: null, problem: `${raw.kind}: value_json が JSON として読めません` };
  }
  const base = { title: raw.title.trim() || "提案", reason: raw.reason.trim() };
  const issues = (e: z.ZodError) => e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("、");
  switch (raw.kind) {
    case "plan_section": {
      const p = planSectionSchema.safeParse(json);
      if (!p.success) return { action: null, problem: `plan_section: 形が正しくありません（${issues(p.error)}）` };
      const v = valueSchemas[p.data.section].safeParse(p.data.value);
      if (!v.success) return { action: null, problem: `plan_section: value が ${p.data.section} の形に合いません（${issues(v.error)}）` };
      const value = toSectionValue(p.data.section, v.data);
      if (!value) return { action: null, problem: "plan_section: 値が長すぎるか、範囲外です" };
      return { action: { kind: "plan_section", ...base, section: p.data.section, value }, problem: null };
    }
    case "goal": {
      const p = goalProposalSchema.safeParse(json);
      if (!p.success) return { action: null, problem: `goal: 形が正しくありません（${issues(p.error)}）` };
      return { action: { kind: "goal", ...base, kgi: p.data.kgi, kpiTargets: p.data.kpi_targets }, problem: null };
    }
    case "roadmap_items": {
      const p = itemsProposalSchema.safeParse(json);
      if (!p.success) return { action: null, problem: `roadmap_items: 形が正しくありません（${issues(p.error)}）` };
      const bad = p.data.items.find((i) => (i.kpi === null) !== (i.target === null));
      if (bad) return { action: null, problem: `roadmap_items: 「${bad.title}」は kpi と target を両方入れるか、両方 null にしてください` };
      return { action: { kind: "roadmap_items", ...base, items: p.data.items }, problem: null };
    }
    case "post_draft": {
      const p = postDraftSchema.safeParse(json);
      if (!p.success) return { action: null, problem: `post_draft: 形が正しくありません（${issues(p.error)}）` };
      return { action: { kind: "post_draft", ...base, sns: p.data.sns, text: p.data.text }, problem: null };
    }
  }
}

// AI の返事を検証する。actionProblem: 提案はあったのに、形に合わないものがあったときの理由（1 回だけ言い直させる）
export function normalizeConsultTurn(raw: unknown): (ConsultTurn & { actionProblem: string | null }) | null {
  const parsed = consultTurnSchema.safeParse(raw);
  if (!parsed.success) return null;
  const actions: ConsultAction[] = [];
  const problems: string[] = [];
  for (const a of parsed.data.actions.slice(0, MAX_ACTIONS)) {
    const { action, problem } = parseAction(a);
    if (action) actions.push(action);
    if (problem) problems.push(problem);
  }
  return {
    message: parsed.data.message.trim(),
    choices: parsed.data.choices.map((c) => c.trim()).filter(Boolean).slice(0, 4),
    actions,
    actionProblem: problems.length ? problems.join(" / ") : null,
  };
}

// 保存してある返事を、AI に履歴として渡す形（構造化出力と同じ形）に戻す
export function toWireConsultTurn(t: ConsultTurn): unknown {
  return {
    message: t.message,
    choices: t.choices,
    actions: t.actions.map((a) => ({ kind: a.kind, title: a.title, reason: a.reason, value_json: JSON.stringify(wireValue(a)) })),
  };
}

function wireValue(a: ConsultAction): unknown {
  switch (a.kind) {
    case "plan_section":
      return { section: a.section, value: toWireValue(a.section, a.value) };
    case "goal":
      return { kgi: a.kgi, kpi_targets: a.kpiTargets };
    case "roadmap_items":
      return { items: a.items };
    case "post_draft":
      return { sns: a.sns, text: a.text };
  }
}
