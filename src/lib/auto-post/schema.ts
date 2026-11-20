import { z } from "zod";
import { FONT_KEYS, PALETTES, TEXT_STYLES } from "@/lib/media/templates";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { AUTO_KINDS_STAGE_A, AUTO_SNS_STAGE_A, TARGET_MODES, type AutoPlanInput } from "./types";

// 自動の回し方の入力の確かめ（DB の save_auto_plan と同じ決まり。ここは画面に早く理由を出すため。本当の確かめは DB）

export const MAX_AUTO_PLANS = 10; // 1 プロジェクト（DB の save_auto_plan と同じ値）
export const MAX_PROJECT_EVENTS = 50; // 1 プロジェクト（DB の project_events_limit と同じ値）
export const AUTO_NAME_MAX = 30;
// 書き方の指示（DB の auto_instructions_valid と同じ値）: 1 つ 100 字まで、8 個まで
export const AUTO_INSTRUCTION_MAX = 100;
export const AUTO_INSTRUCTIONS_MAX = 8;
// 見本を作るのは 1 人 1 日 5 回まで（DB の reserve_ai_usage の c_auto_sample_daily_runs と同じ値）
export const AUTO_SAMPLE_DAILY_RUNS = 5;
export const EVENT_BODY_MAX = 100;
export const DEFAULT_LEAD_HOURS = 24; // A1

const weekday = z.number().int().min(1).max(7);

// 1 つの指示（1 行・1〜100 字。改行などの制御文字は使えない）
export const instructionSchema = z
  .string()
  .trim()
  .min(1, "指示を入れてください。")
  .max(AUTO_INSTRUCTION_MAX, `指示は 1 つ ${AUTO_INSTRUCTION_MAX} 字までです。`)
  // 制御文字（改行を含む）を断る（DB の [[:cntrl:]] と同じ）
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "指示は 1 行で書いてください。");

// 指示の一覧（同じものは 1 つにする。DB の auto_instructions_clean と同じ）
export const instructionsSchema = z
  .array(instructionSchema)
  .max(AUTO_INSTRUCTIONS_MAX, `指示は ${AUTO_INSTRUCTIONS_MAX} 個までです。いらないものを外してください。`)
  .transform((list) => [...new Set(list)]);

export const scheduleSchema = z.object({
  weekdays: z
    .array(weekday)
    .min(1, "曜日を 1 つ以上選んでください。")
    .max(7)
    .refine((d) => new Set(d).size === d.length, "同じ曜日が重なっています。"),
  time: z.string().regex(/^([01][0-9]|2[0-3]):(00|15|30|45)$/, "時刻は 15 分刻みで選んでください。"),
  every_weeks: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  start: z.iso.date(),
});

export const materialsSchema = z
  .object({
    format_id: z.uuid().optional(),
    destination_ids: z.array(z.uuid()).max(20).optional(),
    note_order: z.enum(["old_first", "photo_first"]).optional(),
    skip_if_empty: z.boolean().optional(),
  })
  .strict();

const targetsSchema = z
  .partialRecord(z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]]), z.enum(["auto", "review", "by_hand"]))
  .refine((t) => Object.keys(t).length > 0, "送る SNS を 1 つ以上選んでください。")
  .refine((t) => Object.keys(t).every((k) => AUTO_SNS_STAGE_A.includes(k as SnsKey)), "この SNS には、まだ自動で送れません。")
  .refine((t) => Object.entries(t).every(([k, m]) => TARGET_MODES[k as SnsKey].includes(m!)), "この SNS では選べない送り方です。");

// 自動の回の画像（DB の auto_image_valid と同じ決まり。kind との組み合わせは下の refine）
// 見出しの見た目（DB の auto_image_valid の look と同じ値。色は templates.ts の PALETTES と、いつもの色 brand）
export const autoImageLookSchema = z
  .object({
    palette: z.enum([...PALETTES.map((p) => p.key), "brand"] as unknown as [string, ...string[]]),
    brand: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    font: z.enum(FONT_KEYS),
    textStyle: z.enum(TEXT_STYLES),
  })
  .strict();

export const autoImageSchema = z
  .object({
    source: z.enum(["format", "ai"]),
    style: z.enum(["photo", "illustration"]),
    size: z.enum(["auto", "portrait", "square", "landscape"]),
    headline: z.enum(["none", "format", "ai"]),
    look: autoImageLookSchema.optional(),
  })
  .strict()
  .refine((i) => !i.look || i.headline !== "none", { message: "見出しを重ねないときは、見出しの見た目を持てません。" })
  .refine((i) => i.headline !== "format" || i.source === "format", { message: "フォーマットの見出しは、フォーマットの画像を使うときだけ選べます。" })
  .nullable();

export const autoPlanInputSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "名前を入れてください。").max(AUTO_NAME_MAX, `名前は ${AUTO_NAME_MAX} 字までです。`),
    kind: z.enum(AUTO_KINDS_STAGE_A as [string, ...string[]], { message: "使い道を選んでください。" }),
    materials: materialsSchema,
    targets: targetsSchema,
    xLink: z.enum(["never", "always"]),
    schedule: scheduleSchema,
    instructions: instructionsSchema,
    image: autoImageSchema,
    leadHours: z.number().int().min(1).max(48),
    consent: z.literal(true, { message: "「AI が作った文を、確かめずに送ります」に同意してください。" }),
    sampleId: z.uuid().optional(),
  })
  .refine((p) => p.kind !== "series" || !!p.materials.format_id, { message: "シリーズのフォーマットを選んでください。", path: ["materials"] })
  .refine((p) => !p.image || p.image.source !== "format" || p.kind === "series", { message: "フォーマットの画像は、シリーズのときだけ使えます。", path: ["image"] })
  .refine((p) => !p.image || p.kind !== "product" || p.image.style === "illustration", { message: "商品・サービスの紹介では、AI の画像はイラストだけです（実物と違う商品を、本物の写真のように見せないため）。", path: ["image"] }) as unknown as z.ZodType<AutoPlanInput>;

export const eventInputSchema = z.object({
  onDate: z.iso.date({ message: "日付を選んでください。" }),
  body: z.string().trim().min(1, "中身を入れてください。").max(EVENT_BODY_MAX, `中身は ${EVENT_BODY_MAX} 字までです。`),
});
