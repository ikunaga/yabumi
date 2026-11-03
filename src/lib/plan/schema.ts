import { z } from "zod";
import { actionFromLegacyGoal, DESIRED_ACTIONS } from "@/lib/projects/product-types";
import { KPI_KEYS, MAX_KPIS } from "@/lib/metrics/kpis";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { isYmd } from "@/lib/time";

// アカウント設計（要求 F15）のデータの形。DB の account_plans.data にセクションごとに入る。
// セクションはここに書いた順に画面に並ぶ。名前は投稿の柱が決まらないと決めにくいので、柱 → ハッシュタグ → 持ち方 → 名前の順にしている。
// あなたらしさ（story）は目的のあと、コンセプト（concept）は届けたい相手のあと（2026-11-03 オーナーの了承。docs/architecture.md の 4.50）
// AI 壁打ち（F09）が案を出すときも、この形（セクション単位）で出して保存する想定。

const CHOICE = { message: "選択肢から選んでください" };
const SHARE = "割合は 0〜100 の整数にしてください";

const text = (max: number) => z.string().trim().max(max, `${max.toLocaleString("ja-JP")} 文字以内にしてください`).default("");

// いちばんの目標（見た人にしてほしいこと。決定 D34 で広げた。src/lib/projects/product-types.ts の DESIRED_ACTIONS）。
// 前の版の値（downloads・paid）は、読むときに download・purchase に読み替える（保存してあるデータは動かさない）
export const GOAL_TYPES = DESIRED_ACTIONS;
export const OWNERSHIP_MODES = ["personal", "dedicated", "undecided"] as const;
export const MAX_PILLARS = 5;
// 設計に置けるハッシュタグの数（AI は 3〜6 個を出す。どの投稿にも全部を付けるのではなく、ネタに合うものだけを付ける）
export const MAX_HASHTAGS = 10;
const HASHTAG = "ハッシュタグの中に空白や記号（句読点など）は入れられません。先頭の # はあってもなくても大丈夫です";
// 最初の 1 か月の SNS ごとの週の回数の上限（1 日 2 本まで）
export const MAX_WEEKLY_PER_SNS = 14;
const WEEKLY = `週の回数は 1〜${MAX_WEEKLY_PER_SNS} の整数にしてください`;

// 先頭の # / ＃ は外して持つ。タグの途中に空白や記号があると、SNS がそこでタグを切ってしまう
export function normalizeHashtag(raw: string): string {
  return raw.trim().replace(/^[#＃]+/, "").trim();
}
export function isValidHashtag(tag: string): boolean {
  return /^[\p{L}\p{N}\p{M}_]+$/u.test(tag);
}
const hashtagText = z
  .string()
  .transform(normalizeHashtag)
  .pipe(z.string().min(1, "ハッシュタグを入れてください").max(50, "ハッシュタグは 50 文字以内にしてください").refine(isValidHashtag, HASHTAG));

const snsKeyEnum = z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]]);

// 名前とプロフィールの、SNS ごとに上書きできる項目（予備のユーザー名は共通だけ）
export const PROFILE_OVERRIDE_FIELDS = ["displayName", "handle", "bio", "link"] as const;
export type ProfileOverrideField = (typeof PROFILE_OVERRIDE_FIELDS)[number];
const profileOverrideSchema = z.object({ displayName: text(50), handle: text(30), bio: text(300), link: text(300) });
export type ProfileOverride = z.infer<typeof profileOverrideSchema>;

// あなたらしさの 1 項目: 利用者が書いた文と「投稿に使ってよい」の印（初期はオン）。
// 印がオフの項目は、設計の相棒（まとめるため）にしか渡さない（src/lib/plan/story.ts の storyForAi）
const storyItem = (max: number) =>
  z.preprocess(
    // 前の形（文字列だけ）でも読めるようにする
    (v) => (typeof v === "string" ? { text: v } : v),
    z.object({ text: text(max), shareable: z.boolean().default(true) }),
  ).default({ text: "", shareable: true });

export const sectionSchemas = {
  goal: z.object({
    what: text(500),
    goalType: z.preprocess((v) => (typeof v === "string" ? (actionFromLegacyGoal(v) ?? v) : v), z.enum(GOAL_TYPES, CHOICE).nullable()).default(null),
    note: text(500),
  }),
  // あなたらしさ（2026-11-03 オーナーの了承）。どれも任意。前の版で保存したもの（story なし）は空として読む
  story: z.object({
    // 始めた思い
    why: storyItem(500),
    // 背景・経験
    background: storyItem(500),
    // 自分も抱えて乗り越えた悩み
    struggle: storyItem(500),
    // ほかの人と違う強み
    strength: storyItem(300),
    // それらをまとめた短いストーリー（200 字くらい）
    summary: storyItem(300),
  }),
  // who は projects.target_audience に入る（DB の関数が振り分ける）
  audience: z.object({
    who: text(1000),
    pain: text(500),
    where: text(500),
  }),
  // コンセプト（2026-11-03 オーナーの了承）。Who は audience.who、What は audience.pain から読む（ここには持たない）。
  // How（この商品・サービスでどう解決するか）と、まとめた 1 文（statement）。前の版で保存したもの（concept なし）は空として読む
  concept: z.object({
    how: text(500),
    statement: text(200),
  }),
  pillars: z.object({
    items: z
      .array(
        z.object({
          name: text(50),
          share: z.number(SHARE).int(SHARE).min(0, SHARE).max(100, SHARE).nullable().default(null),
          example: text(200),
          // この柱を使う SNS（2026-11-03 オーナーの要望）。空は「すべての SNS」。前の版で保存したもの（sns なし）も空として読む。
          // 割合は SNS ごとに、その SNS に付いた柱の中で数える（src/lib/plan/pillars.ts）
          // 知らない SNS は捨てて読む（1 つの値のために柱のセクション全体を空にしない）。並びは SNS_KEYS の順にそろえる
          sns: z
            .preprocess((v) => (Array.isArray(v) ? SNS_KEYS.filter((k) => v.includes(k)) : v), z.array(snsKeyEnum, CHOICE))
            .default([]),
        }),
      )
      .max(MAX_PILLARS, `柱は ${MAX_PILLARS} つまでです`)
      .default([]),
    tone: text(300),
    // SNS ごとの口調（2026-11-03 オーナーの決定）。ない SNS・空の SNS は共通の口調（tone）を使う。前の版で保存したものは空。
    // 知らない SNS と空の口調は読むときに捨てる（1 つの値のために柱のセクション全体を空にしない）
    toneBySns: z
      .preprocess(
        (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k, t]) => (SNS_KEYS as string[]).includes(k) && typeof t === "string" && t.trim())) : v),
        z.partialRecord(snsKeyEnum, text(300)),
      )
      .default({}),
    avoid: text(500),
  }),
  // ハッシュタグ（2026-10-20）。タグ（# なし）・どんな人が見ているか・なぜ使うか（why）・どの柱やネタのときに付けるか（when）。
  // 下書きを出す AI は、この中からネタに合うものだけを付ける（docs/architecture.md の 4.15）
  hashtags: z.object({
    items: z
      .array(z.object({ tag: hashtagText, why: text(200), when: text(200) }))
      .max(MAX_HASHTAGS, `ハッシュタグは ${MAX_HASHTAGS} 個までです`)
      .refine((items) => new Set(items.map((i) => i.tag.toLowerCase())).size === items.length, "同じハッシュタグが 2 つあります")
      .default([]),
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
      // SNS ごとの上書き（2026-10-12、決定 D26）。空の項目は共通（上の値）を使う。前の版で保存したものは空
      bySns: z.partialRecord(snsKeyEnum, profileOverrideSchema).default({}),
    }),
  ),
  cadence: z.object({
    frequency: text(200),
    roles: z.partialRecord(z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]]), text(200)).default({}),
  }),
  first_month: z.object({
    goal: text(300),
    metrics: text(500),
    // 数字の画面で先頭に出す数字（決まった名前から 1〜3 個。docs/architecture.md の 4.22）。前の版で保存したものは空
    kpis: z.array(z.enum(KPI_KEYS)).max(MAX_KPIS, `数字は ${MAX_KPIS} つまでにしてください`).default([]),
    // SNS ごとの週の回数（伴走 F18・D29。例 { x: 2, instagram: 1 }）。伴走がこの数字とペースを比べて声をかける。前の版は空
    weekly: z.partialRecord(snsKeyEnum, z.number(WEEKLY).int(WEEKLY).min(1, WEEKLY).max(MAX_WEEKLY_PER_SNS, WEEKLY)).default({}),
    // 1 か月（4 週）を数え始めた週の月曜。週の回数を初めて決めたとき・次の 1 か月を始めたときにサーバーが入れる（withFirstMonthCycle）
    startedOn: z.string().refine(isYmd).nullable().default(null),
  }),
} as const;

export type SectionKey = keyof typeof sectionSchemas;
export const SECTION_KEYS = Object.keys(sectionSchemas) as SectionKey[];
export type SectionValue<K extends SectionKey> = z.infer<(typeof sectionSchemas)[K]>;
export type PlanData = { [K in SectionKey]: SectionValue<K> };

// あなたらしさの項目（画面・AI の材料に出す順）
export const STORY_FIELDS = ["why", "background", "struggle", "strength", "summary"] as const;
export type StoryField = (typeof STORY_FIELDS)[number];

// 画面に出すセクションの番号（1 から）。ほかの画面から「設計の『8 名前とプロフィール』」のように案内するときも、これで数える
export function sectionNumber(key: SectionKey): number {
  return SECTION_KEYS.indexOf(key) + 1;
}

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
    case "story": {
      const st = v as PlanData["story"];
      return STORY_FIELDS.some((f) => filled(st[f].text));
    }
    case "audience":
      return filled((v as PlanData["audience"]).who);
    case "concept":
      return filled((v as PlanData["concept"]).statement);
    case "ownership":
      return (v as PlanData["ownership"]).mode !== null;
    case "profile": {
      const p = v as PlanData["profile"];
      return filled(p.displayName) || filled(p.handle) || filled(p.bio) || Object.values(p.bySns).some((o) => o && (filled(o.displayName) || filled(o.handle) || filled(o.bio)));
    }
    case "pillars":
      return (v as PlanData["pillars"]).items.some((i) => filled(i.name));
    case "hashtags":
      return (v as PlanData["hashtags"]).items.length > 0;
    case "cadence":
      return filled((v as PlanData["cadence"]).frequency);
    case "first_month": {
      const f = v as PlanData["first_month"];
      return filled(f.goal) || Object.keys(f.weekly).length > 0;
    }
    default:
      return false;
  }
}

// 設計の段階を「済み」とするのに要るセクション。投稿を書くのに欠かせない 3 つ。
// あなたらしさ・コンセプト（2026-11-03 に足した）は入れない。入れると、もう設計を終えた人が「済んでいない」に戻り、
// 「いまやること」が 1 段目に戻って伴走も止まるため（2026-11-03 PM の決定。docs/architecture.md の 4.50）。
// コンセプトは「おすすめ」として未記入の並びの先頭に出し、4 段階が済んだあとに概要の小さな帯で促す
export const REQUIRED_FOR_DONE: SectionKey[] = ["goal", "audience", "pillars"];
// 済みの判定には入れないが、先に書くことをすすめるセクション
export const RECOMMENDED_SECTIONS: SectionKey[] = ["concept"];

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
    case "story": {
      // 欄は <項目>（文）と <項目>-shareable（「投稿に使ってよい」のスイッチ。オフのときは送られない）
      const item = (f: StoryField) => ({ text: s(f), shareable: form.get(`${f}-shareable`) === "on" });
      return sectionSchemas.story.safeParse(Object.fromEntries(STORY_FIELDS.map((f) => [f, item(f)])));
    }
    case "audience":
      return sectionSchemas.audience.safeParse({ who: s("who"), pain: s("pain"), where: s("where") });
    case "concept":
      return sectionSchemas.concept.safeParse({ how: s("how"), statement: s("statement") });
    case "ownership":
      return sectionSchemas.ownership.safeParse({ mode: nullable("mode"), reason: s("reason") });
    case "profile": {
      // SNS ごとの欄は sns-<SNS>-<項目>。どれかが入っている SNS だけ残す
      const bySns: Partial<Record<SnsKey, Record<ProfileOverrideField, string>>> = {};
      for (const sns of SNS_KEYS) {
        const o = Object.fromEntries(PROFILE_OVERRIDE_FIELDS.map((f) => [f, s(`sns-${sns}-${f}`)])) as Record<ProfileOverrideField, string>;
        if (PROFILE_OVERRIDE_FIELDS.some((f) => o[f].trim())) bySns[sns] = o;
      }
      return sectionSchemas.profile.safeParse({
        displayName: s("displayName"),
        handle: s("handle"),
        handleBackups: s("handleBackups"),
        bio: s("bio"),
        link: s("link"),
        bySns,
      });
    }
    case "pillars": {
      const items = [];
      for (let i = 0; i < MAX_PILLARS; i++) {
        const name = s(`pillar-${i}-name`);
        const shareRaw = s(`pillar-${i}-share`).trim();
        const example = s(`pillar-${i}-example`);
        if (!name.trim() && !shareRaw && !example.trim()) continue;
        // 数として読めない割合は -1 にして、検証で弾く
        const share = shareRaw === "" ? null : Number.isFinite(Number(shareRaw)) ? Number(shareRaw) : -1;
        // 使う SNS は pillar-<n>-sns（チップ。何も選ばなければすべての SNS）
        items.push({ name, share, example, sns: form.getAll(`pillar-${i}-sns`).map(String) });
      }
      // SNS ごとの口調は tone-<SNS>。空欄は共通の口調を使う（保存しない）
      const toneBySns: Partial<Record<SnsKey, string>> = {};
      for (const sns of SNS_KEYS) if (s(`tone-${sns}`).trim()) toneBySns[sns] = s(`tone-${sns}`);
      return sectionSchemas.pillars.safeParse({ items, tone: s("tone"), toneBySns, avoid: s("avoid") });
    }
    case "hashtags": {
      // 欄は hashtag-<n>-tag / why / when。タグが空の行は捨てる（理由だけ書いた行も、タグがなければ使えないため）
      const items = [];
      for (let i = 0; i < MAX_HASHTAGS; i++) {
        const tag = s(`hashtag-${i}-tag`);
        if (!normalizeHashtag(tag)) continue;
        items.push({ tag, why: s(`hashtag-${i}-why`), when: s(`hashtag-${i}-when`) });
      }
      return sectionSchemas.hashtags.safeParse({ items });
    }
    case "cadence": {
      const roles: Partial<Record<SnsKey, string>> = {};
      for (const sns of SNS_KEYS) {
        const v = s(`role-${sns}`);
        if (v.trim()) roles[sns] = v;
      }
      return sectionSchemas.cadence.safeParse({ frequency: s("frequency"), roles });
    }
    case "first_month": {
      // 週の回数は weekly-<SNS>。空欄・0 は「決めない」。数え始めの日はサーバーが決める（withFirstMonthCycle）
      const weekly: Partial<Record<SnsKey, number>> = {};
      for (const sns of SNS_KEYS) {
        const raw = s(`weekly-${sns}`).trim();
        if (!raw || raw === "0") continue;
        weekly[sns] = Number.isFinite(Number(raw)) ? Number(raw) : -1;
      }
      return sectionSchemas.first_month.safeParse({ goal: s("goal"), metrics: s("metrics"), kpis: form.getAll("kpis").map(String), weekly, startedOn: null });
    }
  }
}
