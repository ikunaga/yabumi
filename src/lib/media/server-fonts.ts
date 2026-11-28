import "server-only";
import path from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";
import type { FontKey, FontSet } from "./templates";

// サーバーで画像に見出しを描くときの書体（docs/design/auto-sample-image.md の 11.。段取り ④）。画面と同じ 5 書体（Google Fonts の OFL。
// ライセンスの文は src/server-fonts/OFL-*.txt）。画面の template-fonts.ts（next/font）と同じ書体・同じ太さを、決まった名前で登録する。
// ファイルは関数に入るように next.config.ts の outputFileTracingIncludes で足している（約 49MB。docs/architecture.md の 4.81）

const FILES: Record<FontKey, string[]> = {
  gothic: ["ZenKakuGothicNew-Medium.ttf", "ZenKakuGothicNew-Bold.ttf"],
  rounded: ["ZenMaruGothic-Medium.ttf", "ZenMaruGothic-Bold.ttf"],
  mincho: ["ShipporiMincho-Medium.ttf", "ShipporiMincho-Bold.ttf"],
  hand: ["KleeOne-Regular.ttf", "KleeOne-SemiBold.ttf"],
  pen: ["Yomogi-Regular.ttf"],
};

const family = (k: FontKey) => `yabumi-${k}`;
const face = (k: FontKey, weight: number) => ({ family: family(k), weight });

// 画面の TEMPLATE_FONTS と同じ太さ（template-fonts.ts）。並べ方（layoutTemplate）はこの名前で字の幅を測る
export const SERVER_FONTS: Record<FontKey, FontSet> = {
  gothic: { heading: face("gothic", 700), calm: face("gothic", 500), body: face("gothic", 500), bodyBold: face("gothic", 700) },
  rounded: { heading: face("rounded", 700), calm: face("rounded", 500), body: face("rounded", 500), bodyBold: face("rounded", 700) },
  mincho: { heading: face("mincho", 700), calm: face("mincho", 500), body: face("mincho", 500), bodyBold: face("mincho", 700) },
  hand: { heading: face("hand", 600), body: face("hand", 400), bodyBold: face("hand", 600) },
  pen: { heading: face("pen", 400), body: face("pen", 400), bodyBold: face("pen", 400) },
};

export const SERVER_FONT_DIR = path.join(process.cwd(), "src", "server-fonts");

let registered = false;

// 1 回だけ登録する（同じ関数の中で何度描いても、読み込みは最初の 1 回）。
// dir は引数で変わるので、ビルドの静的な解析からは外す（外さないと、プロジェクト全体が関数に入る。
// 書体のファイルは next.config.ts の outputFileTracingIncludes で入れている）
export function registerServerFonts(dir: string = SERVER_FONT_DIR): void {
  if (registered) return;
  for (const [key, files] of Object.entries(FILES) as [FontKey, string[]][]) {
    for (const f of files) {
      if (!GlobalFonts.registerFromPath(path.join(/* turbopackIgnore: true */ dir, f), family(key))) throw new Error(`書体を読み込めませんでした（${f}）`);
    }
  }
  registered = true;
}
