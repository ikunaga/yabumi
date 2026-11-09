import { Klee_One, Shippori_Mincho, Yomogi, Zen_Kaku_Gothic_New, Zen_Maru_Gothic } from "next/font/google";
import type { FontKey, FontSet } from "./templates";

// テンプレートの画像に描く書体（docs/architecture.md の 4.25）。どれも Google Fonts の OFL（商用に使える。費用はかからない）。
// 日本語の書体は字ごとに分けて配信されるので、使う字のぶんだけ読み込まれる（全部で数 MB を一度に読まない）。
// 前もって読み込まない（preload: false）。画像をつくる画面を開いて、描くときに document.fonts.load で必要な字だけ読む。
// 2026-11-09 オーナーの指摘「フォントがいかにも AI くさい」: 重い見出しの書体（Dela Gothic One）をやめ、手書きふう（Klee One・Yomogi）と、
// すっきりした明朝（しっぽり明朝）にした。見出しの大きさは、文字の置き方の型（templates.ts の TEXT_STYLES）で控えめにし、
// 太さも、置き方を選べる型では一段細く（calm。すっきり・やわらか・明朝は 500。手書きはもとから細いので見出しの太さのまま）
const gothic = Zen_Kaku_Gothic_New({ weight: ["500", "700"], subsets: ["latin"], display: "swap", preload: false });
const rounded = Zen_Maru_Gothic({ weight: ["500", "700"], subsets: ["latin"], display: "swap", preload: false });
const mincho = Shippori_Mincho({ weight: ["500", "700"], subsets: ["latin"], display: "swap", preload: false });
const hand = Klee_One({ weight: ["400", "600"], subsets: ["latin"], display: "swap", preload: false });
const pen = Yomogi({ weight: "400", subsets: ["latin"], display: "swap", preload: false });

export const TEMPLATE_FONTS: Record<FontKey, FontSet> = {
  gothic: { heading: { family: gothic.style.fontFamily, weight: 700 }, calm: { family: gothic.style.fontFamily, weight: 500 }, body: { family: gothic.style.fontFamily, weight: 500 }, bodyBold: { family: gothic.style.fontFamily, weight: 700 } },
  rounded: { heading: { family: rounded.style.fontFamily, weight: 700 }, calm: { family: rounded.style.fontFamily, weight: 500 }, body: { family: rounded.style.fontFamily, weight: 500 }, bodyBold: { family: rounded.style.fontFamily, weight: 700 } },
  mincho: { heading: { family: mincho.style.fontFamily, weight: 700 }, calm: { family: mincho.style.fontFamily, weight: 500 }, body: { family: mincho.style.fontFamily, weight: 500 }, bodyBold: { family: mincho.style.fontFamily, weight: 700 } },
  hand: { heading: { family: hand.style.fontFamily, weight: 600 }, body: { family: hand.style.fontFamily, weight: 400 }, bodyBold: { family: hand.style.fontFamily, weight: 600 } },
  // ゆるい手書きは太さが 1 つだけなので、見出しも説明もこの太さ
  pen: { heading: { family: pen.style.fontFamily, weight: 400 }, body: { family: pen.style.fontFamily, weight: 400 }, bodyBold: { family: pen.style.fontFamily, weight: 400 } },
};

// 選ぶ画面で、その書体で名前を見せるための class
export const FONT_CLASS: Record<FontKey, string> = { gothic: gothic.className, rounded: rounded.className, mincho: mincho.className, hand: hand.className, pen: pen.className };
