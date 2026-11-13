import { z } from "zod";
import { MAX_STRAIGHTEN, ROTATIONS, TONE_KEYS } from "./adjust";
import { ASPECT_PRESETS } from "./aspect";
import { FONT_KEYS, PHOTO_FITS, TEMPLATE_SIZES, TEXT_STYLES } from "./templates";

// 添えた画像の整え方（docs/architecture.md の 4.68）。投稿の保存で DB（media_files.edit）に書く前に、サーバーで形を確かめる。
// 書きかけの控え（この端末）から戻すときも、同じ形でなければ整え方を戻さない

const tone = z.object(Object.fromEntries(TONE_KEYS.map((k) => [k, z.number().min(-100).max(100)])) as Record<(typeof TONE_KEYS)[number], z.ZodNumber>).strict();

export const adjustmentsSchema = z
  .object({
    tone,
    rotation: z.union(ROTATIONS.map((r) => z.literal(r)) as unknown as [z.ZodLiteral<0>, z.ZodLiteral<90>, z.ZodLiteral<180>, z.ZodLiteral<270>]),
    straighten: z.number().min(-MAX_STRAIGHTEN).max(MAX_STRAIGHTEN),
    crop: z.enum(["original", ...ASPECT_PRESETS.map((p) => p.key)] as [string, ...string[]]),
    pos: z.number().min(0).max(1),
  })
  .strict();

export const headlineSettingsSchema = z
  .object({
    size: z.enum(Object.keys(TEMPLATE_SIZES) as [string, ...string[]]),
    photoFit: z.enum(PHOTO_FITS),
    palette: z.string().max(30),
    brand: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    font: z.enum(FONT_KEYS),
    textStyle: z.enum(TEXT_STYLES),
    label: z.string().max(12),
    headline: z.string().max(40),
    subline: z.string().max(60),
    footer: z.string().max(30),
  })
  .strict();

export const mediaEditSchema = z
  .object({
    kind: z.enum(["aspect", "adjust", "headline"]),
    adjust: adjustmentsSchema.optional(),
    headline: headlineSettingsSchema.optional(),
  })
  .strict();
export type MediaEdit = z.infer<typeof mediaEditSchema>;
