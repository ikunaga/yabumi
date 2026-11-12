import type { EditKind } from "./image-edit";
import {
  DEFAULT_BRAND_COLOR,
  DEFAULT_TEXT_STYLE,
  PALETTES,
  autoAlt,
  brandPalette,
  closestSize,
  type FontKey,
  type FontSet,
  type Palette,
  type PhotoFit,
  type TemplateInput,
  type TemplateSizeKey,
  type TextStyle,
} from "./templates";

// 添えた画像に、あとから見出しを付ける・直す（docs/architecture.md の 4.58）。
// 「写真に見出し」（テンプレートの screen）と同じ描き方で、添えた写真を敷いて見出しを重ね、同じ位置で差し替える

// 見出しを付けたときの設定（この画面の中だけで持ち、「見出しを直す」で欄に戻す。保存はしない）
export type HeadlineSettings = {
  size: TemplateSizeKey;
  photoFit: PhotoFit;
  palette: string;
  brand: string;
  font: FontKey;
  textStyle: TextStyle;
  label: string;
  headline: string;
  subline: string;
  footer: string;
};

export function paletteOf(key: string, brand: string): Palette {
  return key === "brand" ? brandPalette(brand) : (PALETTES.find((p) => p.key === key) ?? PALETTES[0]);
}

// 初めて見出しを付けるときの設定。縦横は写真にいちばん近いもの、写真は全面に敷く。色・文字の形・置き方は前回のもの
export function initialHeadline(
  photo: { width: number; height: number },
  footer: string,
  style?: { palette: string; brand: string; font: FontKey; textStyle: TextStyle } | null,
): HeadlineSettings {
  return {
    size: closestSize(photo.width, photo.height),
    photoFit: "cover",
    palette: style?.palette ?? PALETTES[0].key,
    brand: style?.brand ?? DEFAULT_BRAND_COLOR,
    font: style?.font ?? "gothic",
    textStyle: style?.textStyle ?? DEFAULT_TEXT_STYLE,
    label: "",
    headline: "",
    subline: "",
    footer,
  };
}

export function headlineInput(s: HeadlineSettings, fonts: FontSet, photo: { width: number; height: number }): TemplateInput {
  return {
    kind: "screen",
    size: s.size,
    palette: paletteOf(s.palette, s.brand),
    fonts,
    label: s.label,
    headline: s.headline,
    subline: s.subline,
    footer: s.footer,
    diagramStyle: "points",
    items: [],
    screenshot: { w: photo.width, h: photo.height },
    photoFit: s.photoFit,
    textStyle: s.textStyle,
  };
}

// 添えた画像で出す入口。text: 画像に文字が入っているか（この画面で添えた・つくった画像だけわかる。保存して開き直した画像は undefined）。
// - 最後に見出しを付けた画像: 「見出しを直す」（見出しのない元の写真から描き直す）
// - 文字が入っている画像（文字のカード・図解・note のヘッダー、見出しを付けたあとに縦横を整えた・調整した画像）: 出さない（見出しが 2 つになる）
// - それ以外（上げた写真・AI の写真・開き直した画像）: 「見出しを付ける」
export function headlineAction(image: { text?: boolean; edit?: { kind: EditKind } }): "add" | "edit" | null {
  if (image.edit?.kind === "headline") return "edit";
  return image.text ? null : "add";
}

// 開き直した画像は、文字が入っているかわからない（見出しの欄で、重なるおそれを添える）
export function headlineUnknown(image: { text?: boolean; edit?: { kind: EditKind } }): boolean {
  return image.text === undefined && image.edit?.kind !== "headline";
}

// 整えたあとの画像に文字が入っているか（見出しを付けたら入る。縦横を整える・調整するは、前の画像のまま）
export function textAfterEdit(image: { text?: boolean }, kind: EditKind): boolean | undefined {
  return kind === "headline" ? true : image.text;
}

// 見出しから作る説明文（画像をつくる画面の写真に見出しと同じ）
export function headlineAutoAlt(s: Pick<HeadlineSettings, "label" | "headline" | "subline">): string {
  return autoAlt({ kind: "screen", label: s.label, headline: s.headline, subline: s.subline, diagramStyle: "points", items: [] });
}

// 見出しを付けたあとの説明文。利用者が書いた説明文は変えず、空のときと、前の見出しから作ったままのときだけ、新しい見出しから作る
export function headlineAlt(current: string, settings: HeadlineSettings, prev?: HeadlineSettings): string {
  if (!current.trim() || (prev && current === headlineAutoAlt(prev))) return headlineAutoAlt(settings);
  return current;
}
