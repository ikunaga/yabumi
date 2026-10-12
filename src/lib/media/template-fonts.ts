import { Dela_Gothic_One, Zen_Kaku_Gothic_New, Zen_Maru_Gothic, Zen_Old_Mincho } from "next/font/google";
import type { FontKey, FontSet } from "./templates";

// テンプレートの画像に描く書体（docs/architecture.md の 4.25）。
// 日本語の書体は字ごとに分けて配信されるので、使う字のぶんだけ読み込まれる（全部で数 MB を一度に読まない）。
// 前もって読み込まない（preload: false）。画像をつくる画面を開いて、描くときに document.fonts.load で必要な字だけ読む
const gothic = Zen_Kaku_Gothic_New({ weight: ["500", "700"], subsets: ["latin"], display: "swap", preload: false });
const rounded = Zen_Maru_Gothic({ weight: ["500", "700"], subsets: ["latin"], display: "swap", preload: false });
const mincho = Zen_Old_Mincho({ weight: ["500", "700"], subsets: ["latin"], display: "swap", preload: false });
const pop = Dela_Gothic_One({ weight: "400", subsets: ["latin"], display: "swap", preload: false });

export const TEMPLATE_FONTS: Record<FontKey, FontSet> = {
  gothic: { heading: { family: gothic.style.fontFamily, weight: 700 }, body: { family: gothic.style.fontFamily, weight: 500 }, bodyBold: { family: gothic.style.fontFamily, weight: 700 } },
  rounded: { heading: { family: rounded.style.fontFamily, weight: 700 }, body: { family: rounded.style.fontFamily, weight: 500 }, bodyBold: { family: rounded.style.fontFamily, weight: 700 } },
  mincho: { heading: { family: mincho.style.fontFamily, weight: 700 }, body: { family: mincho.style.fontFamily, weight: 500 }, bodyBold: { family: mincho.style.fontFamily, weight: 700 } },
  // 力強い書体は太さが 1 つだけなので、見出しだけに使い、説明の文字はすっきりの書体にする
  pop: { heading: { family: pop.style.fontFamily, weight: 400 }, body: { family: gothic.style.fontFamily, weight: 500 }, bodyBold: { family: gothic.style.fontFamily, weight: 700 } },
};

// 選ぶ画面で、その書体で名前を見せるための class
export const FONT_CLASS: Record<FontKey, string> = { gothic: gothic.className, rounded: rounded.className, mincho: mincho.className, pop: pop.className };
