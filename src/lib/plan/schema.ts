import { z } from "zod";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";

// アカウント設計（要求 F15）のデータの形。DB の account_plans.data にセクションごとに入る。
// セクションはここに書いた順に画面に並ぶ。名前は投稿の柱が決まらないと決めにくいので、柱 → 持ち方 → 名前の順にしている
// AI 壁打ち（F09）が案を出すときも、この形（セクション単位）で出して保存する想定。

const CHOICE = { message: "選択肢から選んでください" };
const SHARE = "割合は 0〜100 の整数にしてください";

const text = (max: number) => z.string().trim().max(max, `${max.toLocaleString("ja-JP")} 文字以内にしてください`).default("");

export const GOAL_TYPES = ["downloads", "paid", "awareness", "other"] as const;
export const OWNERSHIP_MODES = ["personal", "dedicated", "undecided"] as const;
export const MAX_PILLARS = 5;

export const sectionSchemas = {
  goal: z.object({
    what: text(500),
    goalType: z.enum(GOAL_TYPES, CHOICE).nullable().default(null),
    note: text(500),
  }),
  // who は projects.target_audience に入る（DB の関数が振り分ける）
  audience: z.object({
    who: text(1000),
    pain: text(500),
    where: text(500),
  }),
  pillars: z.object({
    items: z
      .array(z.object({ name: text(50), share: z.number(SHARE).int(SHARE).min(0, SHARE).max(100, SHARE).nullable().default(null), example: text(200) }))
      .max(MAX_PILLARS, `柱は ${MAX_PILLARS} つまでです`)
      .default([]),
    tone: text(300),
    avoid: text(500),
  }),
  ownership: z.object({
    mode: z.enum(OWNERSHIP_MODES, CHOICE).nullable().default(null),
    reason: text(500),
  }),
  // ユーザー名は第一候補（handle）と予備（handleBackups、1 行に 1 つ）。
  // 初版の handles（1 行に 1 つの候補）で保存されたものは、1 行目を第一候補、残りを予備として読む
  profile: z.preprocess(
    (v) => {
      if (!v || typeof v !== "object") return v;
      const { handles, ...rest } = v as Record<string, unknown>;
      if (typeof handles !== "string" || "handle" in rest) return rest;
      const [first = "", ...others] = handles.split("\n").map((h) => h.trim()).filter(Boolean);
      return { ...rest, handle: first, handleBackups: others.join("\n") };
    },
    z.object({
      displayName: text(50),
      handle: text(30),
      handleBackups: text(200),
      bio: text(300),
      link: text(300),
    }),
  ),
  cadence: z.object({
    frequency: text(200),
    roles: z.partialRecord(z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]]), text(200)).default({}),
  }),
  first_month: z.object({
    goal: text(300),
    metrics: text(500),
  }),
} as const;

export type SectionKey = keyof typeof sectionSchemas;
export const SECTION_KEYS = Object.keys(sectionSchemas) as SectionKey[];
export type SectionValue<K extends SectionKey> = z.infer<(typeof sectionSchemas)[K]>;
export type PlanData = { [K in SectionKey]: SectionValue<K> };

export function isSectionKey(v: unknown): v is SectionKey {
  return typeof v === "string" && (SECTION_KEYS as string[]).includes(v);
}

// DB から読んだ data を、足りない項目を空で埋めた形にする。壊れたセクションは空として扱う
export function normalizePlan(raw: unknown, targetAudience: string): PlanData {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<SectionKey, unknown>;
  for (const k of SECTION_KEYS) {
    const parsed = sectionSchemas[k].safeParse(obj[k] ?? {});
    out[k] = parsed.success ? parsed.data : sectionSchemas[k].parse({});
  }
  (out.audience as PlanData["audience"]).who = targetAudience;
  return out as PlanData;
}

const filled = (s: string) => s.trim() !== "";

// セクションが「記入済み」か。そのセクションの要（かなめ）の項目が入っていれば済みとする（docs/requirements.md の F15）
export function isSectionDone<K extends SectionKey>(key: K, v: SectionValue<K>): boolean {
  switch (key) {
    case "goal": {
      const g = v as PlanData["goal"];
      return filled(g.what) || g.goalType !== null;
    }
    case "audience":
      return filled((v as PlanData["audience"]).who);
    case "ownership":
      return (v as PlanData["ownership"]).mode !== null;
    case "profile": {
      const p = v as PlanData["profile"];
      return filled(p.displayName) || filled(p.handle) || filled(p.bio);
    }
    case "pillars":
      return (v as PlanData["pillars"]).items.some((i) => filled(i.name));
    case "cadence":
      return filled((v as PlanData["cadence"]).frequency);
    case "first_month":
      return filled((v as PlanData["first_month"]).goal);
    default:
      return false;
  }
}

// 設計の段階を「済み」とするのに要るセクション。投稿を書くのに欠かせない 3 つ
export const REQUIRED_FOR_DONE: SectionKey[] = ["goal", "audience", "pillars"];

export function isPlanDone(plan: PlanData): boolean {
  return REQUIRED_FOR_DONE.every((k) => isSectionDone(k, plan[k]));
}

// フォームの値をセクションの形にする
export function parseSectionForm<K extends SectionKey>(key: K, form: FormData): z.ZodSafeParseResult<SectionValue<K>> {
  return parseSectionFormAny(key, form) as z.ZodSafeParseResult<SectionValue<K>>;
}

function parseSectionFormAny(key: SectionKey, form: FormData) {
  const s = (name: string) => String(form.get(name) ?? "");
  const nullable = (name: string) => (s(name) === "" ? null : s(name));
  switch (key) {
    case "goal":
      return sectionSchemas.goal.safeParse({ what: s("what"), goalType: nullable("goalType"), note: s("note") });
    case "audience":
      return sectionSchemas.audience.safeParse({ who: s("who"), pain: s("pain"), where: s("where") });
    case "ownership":
      return sectionSchemas.ownership.safeParse({ mode: nullable("mode"), reason: s("reason") });
    case "profile":
      return sectionSchemas.profile.safeParse({
        displayName: s("displayName"),
        handle: s("handle"),
        handleBackups: s("handleBackups"),
        bio: s("bio"),
        link: s("link"),
      });
    case "pillars": {
      const items = [];
      for (let i = 0; i < MAX_PILLARS; i++) {
        const name = s(`pillar-${i}-name`);
        const shareRaw = s(`pillar-${i}-share`).trim();
        const example = s(`pillar-${i}-example`);
        if (!name.trim() && !shareRaw && !example.trim()) continue;
        // 数として読めない割合は -1 にして、検証で弾く
        const share = shareRaw === "" ? null : Number.isFinite(Number(shareRaw)) ? Number(shareRaw) : -1;
        items.push({ name, share, example });
      }
      return sectionSchemas.pillars.safeParse({ items, tone: s("tone"), avoid: s("avoid") });
    }
    case "cadence": {
      const roles: Partial<Record<SnsKey, string>> = {};
      for (const sns of SNS_KEYS) {
        const v = s(`role-${sns}`);
        if (v.trim()) roles[sns] = v;
      }
      return sectionSchemas.cadence.safeParse({ frequency: s("frequency"), roles });
    }
    case "first_month":
      return sectionSchemas.first_month.safeParse({ goal: s("goal"), metrics: s("metrics") });
  }
}
