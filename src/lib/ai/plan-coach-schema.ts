import { z } from "zod";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { GOAL_TYPES, OWNERSHIP_MODES, SECTION_KEYS, sectionSchemas, type SectionKey, type SectionValue } from "@/lib/plan/schema";

// AI（アカウント設計の相棒）の 1 回の返事の形。構造化出力（output_config.format）でこの形に固定する。
// 構造化出力のスキーマは文法にコンパイルされ、大きすぎると 400（compiled grammar is too large）になる。
// そのため案の中身（value）はセクションごとの形をスキーマに並べず、JSON 文字列（value_json）で受け取り、
// サーバー側でセクションの形（valueSchemas）に照らして検証する。形が合わなければ 1 回だけ言い直させる（plan-coach.ts）。

const snsEnum = z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]]);

// 案の中身の形（value_json を JSON として読んだもの）。保存する形とほぼ同じで、SNS ごとの役割だけ配列で受け取る
export const valueSchemas = {
  goal: z.object({ what: z.string(), goalType: z.enum(GOAL_TYPES).nullable(), note: z.string() }),
  audience: z.object({ who: z.string(), pain: z.string(), where: z.string() }),
  pillars: z.object({
    items: z.array(z.object({ name: z.string(), share: z.number().int().nullable(), example: z.string() })),
    tone: z.string(),
    avoid: z.string(),
  }),
  ownership: z.object({ mode: z.enum(OWNERSHIP_MODES).nullable(), reason: z.string() }),
  profile: z.object({ displayName: z.string(), handle: z.string(), handleBackups: z.string(), bio: z.string(), link: z.string() }),
  cadence: z.object({ frequency: z.string(), roles: z.array(z.object({ sns: snsEnum, role: z.string() })) }),
  first_month: z.object({ goal: z.string(), metrics: z.string() }),
} satisfies Record<SectionKey, z.ZodType>;

const proposalSchema = z.object({
  section: z.enum(SECTION_KEYS as [SectionKey, ...SectionKey[]]),
  options: z
    .array(
      z.object({
        title: z.string().describe("案の短い名前"),
        summary: z.string().describe("どんな案か、1〜2 文"),
        pros: z.array(z.string()).describe("長所"),
        cons: z.array(z.string()).describe("短所"),
        value_json: z.string().describe("案の中身。システムプロンプトの「案の中身の形」に合う JSON を文字列にしたもの"),
      }),
    )
    .describe("2〜3 個の案"),
  recommended: z.number().int().describe("おすすめの案の番号（0 から数える）"),
  reason: z.string().describe("おすすめする理由。利用者の答えと目的に結びつけて書く"),
});

export const coachTurnSchema = z.object({
  message: z.string().describe("利用者に話しかける文。質問は一度に 1 つ。用語は使う前にかみ砕く"),
  choices: z.array(z.string()).describe("答えやすい選択肢（0〜4 個）。押すとそのまま利用者の答えになる"),
  proposal: proposalSchema.nullable(),
});

export type ProposalOption<K extends SectionKey = SectionKey> = {
  title: string;
  summary: string;
  pros: string[];
  cons: string[];
  value: SectionValue<K>;
};
export type Proposal = { section: SectionKey; options: ProposalOption[]; recommended: number; reason: string };
export type CoachTurn = { message: string; choices: string[]; proposal: Proposal | null };

// AI の返事を検証し、案の中身を保存する形に直す。
// proposalProblem: 案はあったのに、中身がどれも形に合わなかったときの理由（言い直させるのに使う）
export function normalizeCoachTurn(raw: unknown): (CoachTurn & { proposalProblem: string | null }) | null {
  const base = z.object({ message: z.string(), choices: z.array(z.string()), proposal: z.unknown() }).safeParse(raw);
  if (!base.success) return null;
  const choices = base.data.choices.map((c) => c.trim()).filter(Boolean).slice(0, 4);
  const { proposal, problem } = normalizeProposal(base.data.proposal);
  return { message: base.data.message.trim(), choices, proposal, proposalProblem: problem };
}

function normalizeProposal(raw: unknown): { proposal: Proposal | null; problem: string | null } {
  if (raw === null || raw === undefined) return { proposal: null, problem: null };
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) return { proposal: null, problem: "proposal の形が正しくありません" };
  const { section, recommended, reason } = parsed.data;

  const options: ProposalOption[] = [];
  const problems: string[] = [];
  for (const [i, o] of parsed.data.options.slice(0, 3).entries()) {
    let json: unknown;
    try {
      json = JSON.parse(o.value_json);
    } catch {
      problems.push(`案 ${i + 1}: value_json が JSON として読めません`);
      continue;
    }
    const v = valueSchemas[section].safeParse(json);
    if (!v.success) {
      problems.push(`案 ${i + 1}: value_json が ${section} の形に合いません（${v.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("、")}）`);
      continue;
    }
    const value = toSectionValue(section, v.data);
    if (!value) {
      problems.push(`案 ${i + 1}: 値が長すぎるか、範囲外です（割合は 0〜100、柱は 5 本まで）`);
      continue;
    }
    options.push({ title: o.title, summary: o.summary, pros: o.pros, cons: o.cons, value });
  }
  if (options.length === 0) return { proposal: null, problem: problems.join(" / ") || "案がありません" };
  return {
    proposal: { section, options, recommended: recommended >= 0 && recommended < options.length ? recommended : 0, reason },
    problem: null,
  };
}

// 案の中身を、保存する形（sectionSchemas）にする。上限を超える値などは null
export function toSectionValue(key: SectionKey, value: unknown): SectionValue<SectionKey> | null {
  let v = value;
  if (key === "cadence" && value && typeof value === "object") {
    const c = value as { frequency?: unknown; roles?: unknown };
    const roles: Partial<Record<SnsKey, string>> = {};
    if (Array.isArray(c.roles)) {
      for (const r of c.roles as { sns?: unknown; role?: unknown }[]) {
        if (typeof r.sns === "string" && (SNS_KEYS as string[]).includes(r.sns) && typeof r.role === "string" && r.role.trim()) {
          roles[r.sns as SnsKey] = r.role;
        }
      }
    }
    v = { frequency: c.frequency, roles };
  }
  if (key === "pillars" && value && typeof value === "object") {
    const p = value as { items?: unknown };
    if (Array.isArray(p.items)) v = { ...p, items: (p.items as { name?: unknown }[]).filter((i) => typeof i.name === "string" && i.name.trim()).slice(0, 5) };
  }
  const parsed = sectionSchemas[key].safeParse(v);
  return parsed.success ? (parsed.data as SectionValue<SectionKey>) : null;
}

// 保存してある返事を、AI に履歴として渡す形（構造化出力と同じ形。value は value_json に戻す）にする
export function toWireTurn(t: CoachTurn): unknown {
  return {
    message: t.message,
    choices: t.choices,
    proposal: t.proposal && {
      section: t.proposal.section,
      options: t.proposal.options.map((o) => ({
        title: o.title,
        summary: o.summary,
        pros: o.pros,
        cons: o.cons,
        value_json: JSON.stringify(toWireValue(t.proposal!.section, o.value)),
      })),
      recommended: t.proposal.recommended,
      reason: t.proposal.reason,
    },
  };
}

function toWireValue(key: SectionKey, value: SectionValue<SectionKey>): unknown {
  if (key !== "cadence") return value;
  const c = value as SectionValue<"cadence">;
  return { frequency: c.frequency, roles: Object.entries(c.roles).map(([sns, role]) => ({ sns, role })) };
}
