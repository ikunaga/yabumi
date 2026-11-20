import { z } from "zod";
import { DEFAULT_BRAND_COLOR, DEFAULT_TEXT_STYLE, FONT_KEYS, PALETTES, TEXT_STYLES, type FontKey, type TextStyle } from "./templates";

// 見出しの見た目（色・いつもの色・書体・置き方）。投稿をつくるの「文字を入れる」と同じ選び方（StyleFields）。
// 投稿のフォーマットの画像の設定（post_formats.image.look）と、自動の回し方の画像の設定（auto_plans.image.look）で同じ形。
// DB の check（post_formats_image_shape・auto_image_valid）と同じ値
export type HeadlineLook = { palette: string; brand: string; font: FontKey; textStyle: TextStyle };

export const LOOK_PALETTE_KEYS = [...PALETTES.map((p) => p.key), "brand"] as const;

export const headlineLookSchema = z
  .object({
    palette: z.enum(LOOK_PALETTE_KEYS as unknown as [string, ...string[]]),
    brand: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    font: z.enum(FONT_KEYS),
    textStyle: z.enum(TEXT_STYLES),
  })
  .strict();

// 何も選んでいないときの見た目（藍・すっきり・左に控えめ）
export const DEFAULT_LOOK: HeadlineLook = { palette: PALETTES[0].key, brand: DEFAULT_BRAND_COLOR, font: "gothic", textStyle: DEFAULT_TEXT_STYLE };

// DB や画面から来た値を読む（形が違えば null）
export function readLook(v: unknown): HeadlineLook | null {
  const r = headlineLookSchema.safeParse(v);
  return r.success ? (r.data as HeadlineLook) : null;
}
