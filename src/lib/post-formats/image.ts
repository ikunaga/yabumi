import { PHOTO_STYLES, PHOTO_STYLE_LABEL, type PhotoStyle } from "@/lib/ai/photo";
import { TEMPLATE_SIZES, type TemplateSizeKey } from "@/lib/media/templates";
import { formatSlots } from "./schema";
import { readLook, type HeadlineLook } from "@/lib/media/look";
import { DEFAULT_ANSWER_NAME, isSeries, type FormatSeries } from "./series";

// 投稿のフォーマットの画像の設定（docs/design/format-image.md の 1.、2026-11-17 オーナーの了承）。画面とサーバーの両方から読む。
// 自動の投稿の段階 C でも同じ関数で絵の説明を埋める（3.）。字数と値の正は DB（20261117120000_format_image の check）。ここはその写しと決まりの関数

export const MAX_IMAGE_PROMPT = 600;
export const MAX_IMAGE_HEADLINE = 40;
// 見出しの上に重ねる小さい文（ラベル。2026-11-20 オーナーの指示。見出しを 2 段にする）
export const MAX_IMAGE_LABEL = 20;

// fill: 穴の言葉をそのまま入れて画像の AI に渡す（Claude を使わない）。ai: 穴の言葉と絵の説明を材料に、Claude が場面を 1 つ書く
export const IMAGE_SCENES = ["fill", "ai"] as const;
export type ImageScene = (typeof IMAGE_SCENES)[number];
export const IMAGE_SCENE_LABEL: Record<ImageScene, string> = { fill: "空欄の言葉をそのまま使う", ai: "AI が絵の説明を書く" };

// auto: 送り先に合わせる（いまの画像をつくる画面の既定と同じ）
export type ImageSize = "auto" | TemplateSizeKey;
export const IMAGE_SIZES: ImageSize[] = ["auto", ...(Object.keys(TEMPLATE_SIZES) as TemplateSizeKey[])];

// label: 見出しの上に重ねる小さい文（見出しがあるときだけ描く。{空欄} を使える）
// look: 見出しの見た目（色・書体・置き方。見出しがあるときだけ。null は既定の見た目か、「文字を入れる」で前に使った見た目）
export type FormatImage = { prompt: string; scene: ImageScene; style: PhotoStyle; size: ImageSize; headline: string | null; label: string | null; look: HeadlineLook | null };

export const EMPTY_IMAGE: FormatImage = { prompt: "", scene: "fill", style: "photo", size: "auto", headline: null, label: null, look: null };

const SLOT = /\{([^{}\n]*)\}/g;

const oneLine = (s: unknown, max: number) => (typeof s === "string" ? [...s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()].slice(0, max).join("") : "");
const multiLine = (s: unknown, max: number) =>
  typeof s === "string" ? [...s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim()].slice(0, max).join("") : "";

// 答えの穴の名前（シリーズのときだけ）。答えの決まりがないシリーズでも、AI は答えを書く（format-series.md の 1）ので「答え」で使える
export function answerSlotName(series: FormatSeries | null | undefined): string | null {
  if (series?.answer) return series.answer.name || DEFAULT_ANSWER_NAME;
  return isSeries(series) ? DEFAULT_ANSWER_NAME : null;
}

// 絵の説明・見出しで使える穴（型の文の穴 + 答え）。答えの名前が型の文の穴と同じなら、型の文の穴として扱う
export function imageSlotNames(body: string, series: FormatSeries | null | undefined): string[] {
  const names = formatSlots(body);
  const a = answerSlotName(series);
  return a && !names.includes(a) ? [...names, a] : names;
}

const namesIn = (text: string) => [...new Set([...text.matchAll(SLOT)].map((m) => m[1].trim()))];

// 答えか AI が埋める空欄を使っているか（使っていれば、初めは「AI が絵の説明を書く」を選んでおき、「そのまま使う」には注意を出す。1.1。2026-11-20 から固定しない）
export function needsAiScene(img: Pick<FormatImage, "prompt" | "headline">, body: string, series: FormatSeries | null | undefined): boolean {
  const slots = formatSlots(body);
  const answer = answerSlotName(series);
  const aiNames = new Set([...Object.keys(series?.slots ?? {}), ...(answer && !slots.includes(answer) ? [answer] : [])]);
  return namesIn(img.prompt).some((n) => aiNames.has(n));
}

// 絵の説明で答えを使っているか（クイズでは答えが絵でわかってしまう注意を出す）
export function usesAnswer(prompt: string, body: string, series: FormatSeries | null | undefined): boolean {
  const a = answerSlotName(series);
  return !!a && !formatSlots(body).includes(a) && namesIn(prompt).includes(a);
}

// DB から読んだ値を決まった形にそろえる（形が違えば「画像なし」）
export function readFormatImage(raw: unknown): FormatImage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const prompt = multiLine(r.prompt, MAX_IMAGE_PROMPT);
  if (!prompt) return null;
  const headline = oneLine(r.headline, MAX_IMAGE_HEADLINE);
  const label = oneLine(r.label, MAX_IMAGE_LABEL);
  return {
    prompt,
    scene: (IMAGE_SCENES as readonly unknown[]).includes(r.scene) ? (r.scene as ImageScene) : "fill",
    style: (PHOTO_STYLES as readonly unknown[]).includes(r.style) ? (r.style as PhotoStyle) : "photo",
    size: (IMAGE_SIZES as unknown[]).includes(r.size) ? (r.size as ImageSize) : "auto",
    headline: headline || null,
    label: label || null,
    // 見た目は見出しがあるときだけ持つ
    look: headline ? readLook(r.look) : null,
  };
}

// 編集の欄から来た値を、保存する形にする。絵の説明が空なら「画像なし」（null）。
// 型の文にない空欄は断る（problem）。場面のつくり方は利用者が選んだとおりに保存する（2026-11-20 オーナーの決定で、AI に固定しない）
export function cleanFormatImage(raw: unknown, body: string, series: FormatSeries | null | undefined): { image: FormatImage | null; problem?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { image: null };
  const r = raw as Record<string, unknown>;
  if (typeof r.prompt === "string" && [...r.prompt.trim()].length > MAX_IMAGE_PROMPT) return { image: null, problem: `絵の説明は ${MAX_IMAGE_PROMPT} 字までです` };
  if (typeof r.headline === "string" && [...r.headline.trim()].length > MAX_IMAGE_HEADLINE) return { image: null, problem: `見出しは ${MAX_IMAGE_HEADLINE} 字までです` };
  if (typeof r.label === "string" && [...r.label.trim()].length > MAX_IMAGE_LABEL) return { image: null, problem: `見出しの上の小さい文は ${MAX_IMAGE_LABEL} 字までです` };
  const img = readFormatImage(raw);
  if (!img) return { image: null };
  const allowed = imageSlotNames(body, series);
  const unknown = [...namesIn(img.prompt), ...namesIn(img.headline ?? ""), ...namesIn(img.label ?? "")].filter((n) => !allowed.includes(n));
  if (unknown.some((n) => !n)) return { image: null, problem: "絵の説明の { } の中に、空欄の名前を入れてください" };
  if (unknown.length) return { image: null, problem: `絵の説明に、型の文にない空欄 {${unknown[0]}} があります` };
  return { image: img };
}

// 穴の言葉と答えを入れる。埋まらなかった穴は【穴の名前】で残す（残ったままではつくれない）
export function fillImageText(text: string, values: Record<string, string>, answer: { name: string; value: string } | null): string {
  return text.replace(SLOT, (_, raw: string) => {
    const n = raw.trim();
    const v = values[n]?.trim() || (answer && answer.name === n ? answer.value.trim() : "");
    return v ? v : `【${n}】`;
  });
}

// 【】が残っているか（埋まらなかった穴。つくるは押せない）
export const hasUnfilled = (text: string) => /【[^【】\n]+】/.test(text);

// 自動の投稿の「画像」に出す、フォーマットの画像の設定の要約（「写真・縦 4:5・見出しあり」）
export function imageSpecText(img: FormatImage): string {
  const size = img.size === "auto" ? "送り先に合わせた縦横" : TEMPLATE_SIZES[img.size].label;
  return [PHOTO_STYLE_LABEL[img.style].replace(/のように|で$/g, ""), size, img.headline ? "見出しあり" : "見出しなし"].join("・");
}

// 一覧の行の 1 行（「画像: イラスト・見出しあり」）
export function imageSummary(img: FormatImage): string {
  return ["画像: " + PHOTO_STYLE_LABEL[img.style].replace(/のように|で$/g, ""), img.scene === "ai" ? "AI が絵の説明を書く" : null, img.headline ? "見出しあり" : null].filter(Boolean).join("・");
}

// ③ の帯から画像をつくる画面に渡すもの（docs/design/format-image.md の 2.1）。seq が変わるたびに開き直す。
// auto: 開いてすぐ 1 枚つくる（「つくる」を押したとき）。false は絵の説明を入れて開くだけ（「自分で場面を書く」）。
// text: 穴の言葉と答えを入れた絵の説明（fill はそのまま画像の AI に、ai はサーバーが読み直して Claude が場面に直す）
export type FormatPhotoPreset = {
  seq: number;
  auto: boolean;
  formatId: string;
  name: string;
  scene: ImageScene;
  text: string;
  values: Record<string, string>;
  answer: string;
  style: PhotoStyle;
  size: ImageSize;
  headline: string | null;
  label: string | null;
  look: HeadlineLook | null;
};

// 選んでいるフォーマットと穴の言葉から、帯に出す絵の説明と見出しを作る（答えはシリーズのときだけ）
export function formatPhotoTexts(
  f: { body: string; series: FormatSeries; image: FormatImage },
  values: Record<string, string>,
  answer: string | undefined,
): { text: string; headline: string | null; label: string | null } {
  const name = answerSlotName(f.series);
  const a = name && answer?.trim() ? { name, value: answer.trim() } : null;
  // 小さい文は見出しがあるときだけ（見出しなしで小さい文だけは描かない）
  return {
    text: fillImageText(f.image.prompt, values, a),
    headline: f.image.headline ? fillImageText(f.image.headline, values, a) : null,
    label: f.image.headline && f.image.label ? fillImageText(f.image.label, values, a) : null,
  };
}
