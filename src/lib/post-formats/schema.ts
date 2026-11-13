import { z } from "zod";
import type { FormatSeries } from "./series";
import type { ProductType } from "@/lib/projects/product-types";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { MAX_TARGET_HASHTAGS, hashtagInputProblem, parseHashtagInput } from "@/lib/sns/hashtags";

// 投稿のフォーマット（繰り返し出す投稿の型。docs/design/post-formats.md、docs/architecture.md の 4.56）。画面とサーバーの両方から読む。
// 上限と字数の正は DB（20261110120000_post_formats の check とトリガー）。ここはその写しと、穴の読み方

export const MAX_POST_FORMATS = 20;
// 1 人の合計（プロジェクトはいくつも作れるので。DB のトリガーで同じ値）
export const MAX_POST_FORMATS_PER_USER = 100;
export const MAX_FORMAT_NAME = 40;
export const MAX_FORMAT_PURPOSE = 100;
export const MAX_FORMAT_BODY = 600;
export const MAX_FORMAT_EXAMPLE = 600;
export const MAX_FORMAT_PILLAR = 50;
// 穴は 8 種類まで（同じ名前は 1 つ）、名前は 12 字まで
export const MAX_FORMAT_SLOTS = 8;
export const MAX_SLOT_NAME = 12;
// 穴に入れる言葉の長さ（投稿をつくるの小さな欄）
export const MAX_SLOT_VALUE = 200;
// AI とつくるのは 1 人 1 日 10 回まで（DB の reserve_ai_usage の c_post_format_daily_runs と同じ値。20261110130000_post_format_ai）
export const POST_FORMAT_DAILY_RUNS = 10;

// AI とつくるときの入力の長さと、案の数（src/lib/ai/post-format-ai.ts）
export const MAX_FORMAT_KIND = 100;
export const MAX_FORMAT_MUST = 100;
export const MAX_FORMAT_REFINE = 100;
export const FORMAT_PROPOSALS = 3;

// 「何の投稿か」の決まった選択肢（柱がなくても選べるように。宣伝するものの種類ごと）
export const FORMAT_KINDS: Record<ProductType, string[]> = {
  app: ["アップデートのお知らせ", "使い方のコツ", "作っている途中の話", "使ってくれた人の声"],
  web_service: ["新しい機能のお知らせ", "使い方のコツ", "作っている途中の話", "使ってくれた人の声"],
  shop: ["新メニュー・季節の商品", "お店の日常", "来てくれた方の声", "お休み・イベントのお知らせ"],
  online_shop: ["新作・再入荷", "つくっているところ", "商品の使い方", "買ってくれた方の声"],
  service: ["空き枠のお知らせ", "よくある質問", "受けてくれた方の声", "日々の様子"],
  creator: ["新しい作品", "制作の裏話", "お知らせ（展示・販売・配信）", "見てくれた方の声"],
  other: ["お知らせ", "活動の様子", "参加してくれた方の声", "よくある質問"],
};

// 毎回付けるタグ（# なし。docs/architecture.md の 4.59）。all は全 SNS 共通、SNS の名前のキーはその SNS だけ（あればこちらを使う）。それぞれ 5 個まで
export type FormatHashtagKey = "all" | SnsKey;
export const FORMAT_HASHTAG_KEYS: FormatHashtagKey[] = ["all", ...SNS_KEYS];
export type FormatHashtags = Partial<Record<FormatHashtagKey, string[]>>;

// その SNS に付けるタグ（SNS だけのタグがあればそれ、なければ共通）
export function formatTagsFor(h: FormatHashtags | null | undefined, sns: SnsKey): string[] {
  const own = h?.[sns];
  return own && own.length ? own : (h?.all ?? []);
}

export function hasFormatHashtags(h: FormatHashtags | null | undefined): boolean {
  return FORMAT_HASHTAG_KEYS.some((k) => (h?.[k]?.length ?? 0) > 0);
}

// DB から読んだ値（jsonb）を、決まった形にそろえる（形が違うものは捨てる）
export function readFormatHashtags(raw: unknown): FormatHashtags {
  const out: FormatHashtags = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const k of FORMAT_HASHTAG_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (Array.isArray(v)) {
      const tags = v.filter((t): t is string => typeof t === "string" && t !== "");
      if (tags.length) out[k] = tags;
    }
  }
  return out;
}

export const hashtagKeyLabel = (k: FormatHashtagKey) => (k === "all" ? "全部の SNS" : SNS[k].label);

// 編集の欄から（キーごとに「#a #b」の文字か、タグの配列）。空のキーは持たない
const hashtagsInput = z
  .record(z.string(), z.union([z.string().max(1000), z.array(z.string().max(100)).max(20)]))
  .default({})
  .transform((raw, ctx) => {
    const out: FormatHashtags = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!(FORMAT_HASHTAG_KEYS as string[]).includes(k)) continue;
      const key = k as FormatHashtagKey;
      const text = Array.isArray(v) ? v.join(" ") : v;
      const problem = hashtagInputProblem(text);
      if (problem) {
        ctx.addIssue({ code: "custom", message: `${hashtagKeyLabel(key)} のタグ: ${problem}` });
        return z.NEVER;
      }
      const { tags } = parseHashtagInput(text);
      if (tags.length) out[key] = tags.slice(0, MAX_TARGET_HASHTAGS);
    }
    return out;
  });

// series: シリーズ投稿の設定（AI が埋める穴と答え。docs/design/format-series.md。src/lib/post-formats/series.ts）
export type PostFormat = { id: string; name: string; purpose: string; body: string; example: string; pillar: string; hashtags: FormatHashtags; series: FormatSeries };
export type PostFormatInput = Omit<PostFormat, "id" | "series"> & { series?: FormatSeries };

// {穴の名前}。名前に「{」「}」と改行は入らない
const SLOT = /\{([^{}\n]*)\}/g;

// 本文の穴の名前（出てくる順、同じ名前は 1 つ。前後の空白は落とす）
export function formatSlots(body: string): string[] {
  const names: string[] = [];
  for (const m of body.matchAll(SLOT)) {
    const n = m[1].trim();
    if (n && !names.includes(n)) names.push(n);
  }
  return names;
}

// 本文の穴の決まり（8 種類まで・名前は 12 字まで・空の {} は置かない）。合っていれば null
export function slotProblem(body: string): string | null {
  const raw = [...body.matchAll(SLOT)].map((m) => m[1].trim());
  if (raw.some((n) => !n)) return "{ } の中に、穴の名前を入れてください";
  if (raw.some((n) => [...n].length > MAX_SLOT_NAME)) return `穴の名前は ${MAX_SLOT_NAME} 字までです`;
  if (formatSlots(body).length > MAX_FORMAT_SLOTS) return `穴は ${MAX_FORMAT_SLOTS} 種類までです`;
  if (raw.length > MAX_FORMAT_SLOTS * 2) return `穴は ${MAX_FORMAT_SLOTS * 2} か所までです`;
  return null;
}

const oneLine = (max: number, label: string) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
    .pipe(z.string().max(max, `${label}は ${max} 字までです`));

const multiLine = (max: number, label: string) =>
  z
    .string()
    .transform((s) => s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim())
    .pipe(z.string().max(max, `${label}は ${max} 字までです`));

export const formatInputSchema = z.object({
  name: oneLine(MAX_FORMAT_NAME, "名前").pipe(z.string().min(1, "名前を入れてください")),
  purpose: oneLine(MAX_FORMAT_PURPOSE, "いつ使う").catch(""),
  body: multiLine(MAX_FORMAT_BODY, "本文")
    .pipe(z.string().min(1, "本文を入れてください"))
    .superRefine((b, ctx) => {
      const p = slotProblem(b);
      if (p) ctx.addIssue({ code: "custom", message: p });
    }),
  example: multiLine(MAX_FORMAT_EXAMPLE, "埋めた例").default(""),
  pillar: oneLine(MAX_FORMAT_PILLAR, "柱").default(""),
  hashtags: hashtagsInput,
  // 形をそろえ、型の文にない穴の指示を捨てるのは保存のとき（store.ts の checkFormat で cleanSeries）
  series: z.custom<FormatSeries>(() => true).optional(),
});

// 穴に入れた言葉（穴の名前 → 言葉）。知らない穴と空の言葉は捨て、言葉は 1 行・200 字まで
export function cleanSlotValues(body: string, raw: unknown): Record<string, string> {
  const names = formatSlots(body);
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const n of names) {
    const v = (raw as Record<string, unknown>)[n];
    if (typeof v !== "string") continue;
    const t = [...v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()].slice(0, MAX_SLOT_VALUE).join("");
    if (t) out[n] = t;
  }
  return out;
}

// 穴を埋めた本文。埋めなかった穴は【穴の名前】で残す（【】が残った投稿は送れない。src/lib/posts/actions.ts）
export function fillFormat(body: string, values: Record<string, string>): string {
  return body.replace(SLOT, (_, name: string) => {
    const n = name.trim();
    const v = values[n]?.trim();
    return v ? v : `【${n}】`;
  });
}

// まだ埋めていない穴（本文に入れると【穴の名前】のまま残るもの）。全部埋めたら空（「【】で残っています」と出さない。2026-11-12 PMO の通しテスト 02）
export function unfilledSlots(body: string, values: Record<string, string>): string[] {
  return formatSlots(body).filter((s) => !values[s]?.trim());
}

// 本文の欄に入れる。いまの本文が空なら埋めた本文、"replace" は置きかえ、"append" は空行を 1 つあけて下に足す
export function insertFormatted(current: string, filled: string, how: "replace" | "append"): string {
  if (!current.trim() || how === "replace") return filled;
  return `${current.replace(/\s+$/, "")}\n\n${filled}`;
}

// はじめから出す例（「例から足す」。AI を使わない）。宣伝するものの種類ごとに 2 つ + 共通の 1 つ。
// 例の文も日本語の決まり（src/lib/ai/japanese-style.ts）に合わせる（体言止めを続けない、「！」を使わない、呼びかけない）
type Example = PostFormatInput;
// 例にタグは入れない（タグは人ごとに決めるもの）
const ex = (name: string, purpose: string, body: string): Example => ({ name, purpose, body, example: "", pillar: "", hashtags: {} });

const COMMON: Example[] = [ex("今週の振り返り", "1 週間の終わりに、あったことを短く伝えるとき", "今週は{よかったこと}。\n来週は{次にやること}。\n{ひとこと}")];

export const FORMAT_EXAMPLES: Record<ProductType, Example[]> = {
  app: [
    ex("アップデートのお知らせ", "新しい版を出したとき", "{版}で{変わったこと}。\n{うれしいところ}\n{ひとこと}"),
    ex("使い方のコツ", "知られていない機能や使い方を伝えるとき", "{機能の名前}の使い方のコツです。\n{やり方}\n{どんなときに便利か}"),
    ...COMMON,
  ],
  web_service: [
    ex("アップデートのお知らせ", "新しい機能や直したところを伝えるとき", "{何が}できるようになりました。\n{うれしいところ}\n{ひとこと}"),
    ex("使い方のコツ", "知られていない機能や使い方を伝えるとき", "{機能の名前}の使い方のコツです。\n{やり方}\n{どんなときに便利か}"),
    ...COMMON,
  ],
  shop: [
    ex("新メニューのお知らせ", "新しいメニューや季節の商品を出すとき", "【新メニュー】{何が}\n{いつから}から、{いくら}でお出しします。\n{ひとこと}"),
    ex("来てくれた方の声", "うれしい言葉をいただいたとき", "{どんな方が}に、{何を}について「{言われたこと}」と言っていただきました。\n{お礼のひとこと}"),
    ...COMMON,
  ],
  online_shop: [
    ex("新作・再入荷", "新しい商品を出したときや、再び並べたとき", "{商品の名前}を{新作か再入荷か}しました。\n{どんなところがいいか}\n{サイズや色}"),
    ex("つくっているところ", "これから出すものの途中を見せるとき", "{いまつくっているもの}をつくっています。\n{こだわっているところ}\n{いつごろ並ぶか}"),
    ...COMMON,
  ],
  service: [
    ex("空き枠のお知らせ", "予約の空きができたとき", "{いつ}の枠に空きがあります。\n{どんな内容か}\n{申し込み方}"),
    ex("よくある質問", "よく聞かれることに答えるとき", "「{よく聞かれること}」とよく聞かれます。\n{答え}\n{ひとこと}"),
    ...COMMON,
  ],
  creator: [
    ex("新しい作品", "作品ができたとき", "{作品の名前}ができました。\n{つくったきっかけ}\n{見どころ}"),
    ex("制作の裏話", "つくっている途中を見せるとき", "{何をつくっているか}の途中です。\n{苦労したところ}\n{次の予定}"),
    ...COMMON,
  ],
  other: [
    ex("お知らせ", "日にちや場所が決まったことを伝えるとき", "{何が}を{いつ}に{どこで}行います。\n{どんな内容か}\n{申し込み方}"),
    ex("活動の様子", "最近の活動を伝えるとき", "{何をしたか}。\n{よかったところ}\n{次の予定}"),
    ...COMMON,
  ],
};
