import { z } from "zod";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { AUTO_KINDS_STAGE_A, AUTO_SNS_STAGE_A, TARGET_MODES, type AutoPlanInput } from "./types";

// 自動の回し方の入力の確かめ（DB の save_auto_plan と同じ決まり。ここは画面に早く理由を出すため。本当の確かめは DB）

export const MAX_AUTO_PLANS = 10; // 1 プロジェクト（DB の save_auto_plan と同じ値）
export const MAX_PROJECT_EVENTS = 50; // 1 プロジェクト（DB の project_events_limit と同じ値）
export const AUTO_NAME_MAX = 30;
export const AUTO_TONE_MAX = 100;
export const EVENT_BODY_MAX = 100;
export const DEFAULT_LEAD_HOURS = 24; // A1

const weekday = z.number().int().min(1).max(7);

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

export const autoPlanInputSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "名前を入れてください。").max(AUTO_NAME_MAX, `名前は ${AUTO_NAME_MAX} 字までです。`),
    kind: z.enum(AUTO_KINDS_STAGE_A as [string, ...string[]], { message: "使い道を選んでください。" }),
    materials: materialsSchema,
    targets: targetsSchema,
    xLink: z.enum(["never", "always"]),
    schedule: scheduleSchema,
    tone: z.string().trim().max(AUTO_TONE_MAX, `口調の指示は ${AUTO_TONE_MAX} 字までです。`),
    leadHours: z.number().int().min(1).max(48),
    consent: z.literal(true, { message: "「AI が作った文を、確かめずに送ります」に同意してください。" }),
  })
  .refine((p) => p.kind !== "series" || !!p.materials.format_id, { message: "シリーズのフォーマットを選んでください。", path: ["materials"] }) as unknown as z.ZodType<AutoPlanInput>;

export const eventInputSchema = z.object({
  onDate: z.iso.date({ message: "日付を選んでください。" }),
  body: z.string().trim().min(1, "中身を入れてください。").max(EVENT_BODY_MAX, `中身は ${EVENT_BODY_MAX} 字までです。`),
});
