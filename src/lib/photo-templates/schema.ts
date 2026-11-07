import { z } from "zod";
import type { ProductType } from "@/lib/projects/product-types";

// AI で画像をつくるときの「絵の説明のフォーマット」（docs/architecture.md の 4.25 の ②、2026-11-07）。画面とサーバーの両方から読む。
// 上限と字数の正は DB（20261107120000_photo_prompt_templates の check とトリガー）。ここはその写し

export const MAX_PHOTO_TEMPLATES = 20;
// 1 人の合計（プロジェクトはいくつも作れるので。DB のトリガーで同じ値）
export const MAX_PHOTO_TEMPLATES_PER_USER = 100;
export const MAX_TEMPLATE_NAME = 40;
export const MAX_TEMPLATE_BODY = 600;
// 場面を差し込む穴（AI の案か、書いた場面が入る）
export const SCENE_SLOT = "{場面}";

export type PhotoTemplate = { id: string; name: string; body: string; isDefault: boolean };

export const templateInputSchema = z.object({
  name: z.string().trim().min(1, "名前を入れてください").max(MAX_TEMPLATE_NAME, `名前は ${MAX_TEMPLATE_NAME} 字までです`),
  body: z.string().trim().min(1, "本文を入れてください").max(MAX_TEMPLATE_BODY, `本文は ${MAX_TEMPLATE_BODY} 字までです`),
});

export function hasSceneSlot(body: string): boolean {
  return body.includes(SCENE_SLOT);
}

// フォーマットに場面を入れて、絵の説明にする。穴がなければ、場面のあとに「。」でつないでフォーマットの文を続ける。穴があって場面が空なら、穴を消す
export function fillTemplate(body: string, scene: string): string {
  const s = scene.trim();
  if (hasSceneSlot(body)) return body.split(SCENE_SLOT).join(s).replace(/\s+/g, " ").replace(/^[、。,\s]+/, "").trim();
  return s ? `${s.replace(/[。、,.\s]+$/, "")}。${body.trim()}` : body.trim();
}

// はじめから出す例（「例から追加」）。宣伝するものの種類ごとに 2〜3 個。雰囲気・光・撮り方を決め、何を写すかは {場面} に入れる
export const TEMPLATE_EXAMPLES: Record<ProductType, { name: string; body: string }[]> = {
  app: [
    { name: "手元とスマホ", body: "{場面}。机の上でスマホを持つ手元を近くから、顔は写さない。昼の自然光で明るく、背景はすっきり" },
    { name: "暮らしの一場面", body: "{場面}。家の中のくつろいだ場面、人物は後ろ姿か手元だけ。やわらかい朝の光、落ち着いた色" },
  ],
  web_service: [
    { name: "作業の机", body: "{場面}。ノートパソコンのある机を少し上から、人物は手元だけ。窓からの自然光、白と木の色" },
    { name: "使っている場面", body: "{場面}。仕事や家の中で使っている場面、人物は後ろ姿。明るく清潔な雰囲気" },
  ],
  shop: [
    { name: "商品をテーブルに", body: "{場面}。白い木のテーブルの上、やわらかい自然光で、少し斜め上から近く。背景はぼかす" },
    { name: "店内の雰囲気", body: "{場面}。店内の様子、暖色の明かり、人物は後ろ姿か手元だけ。落ち着いた雰囲気" },
    { name: "店先の朝", body: "{場面}。朝の店先、通りからの目線で。やわらかい朝日、人は写さない" },
  ],
  online_shop: [
    { name: "商品を白い背景で", body: "{場面}。白い背景の上、真上から、影がやわらかく出る明るい光" },
    { name: "使っている様子", body: "{場面}。暮らしの中で使っている様子、手元だけ。自然光、ナチュラルな色" },
  ],
  service: [
    { name: "教室・サロンの様子", body: "{場面}。部屋の様子、人物は後ろ姿か手元だけ。窓からのやわらかい光、清潔で落ち着いた雰囲気" },
    { name: "道具を並べて", body: "{場面}。使う道具を木の机に並べて、少し上から近く。自然光" },
  ],
  creator: [
    { name: "作業の手元", body: "{場面}。作業している手元を近くから、顔は写さない。机のスタンドの明かり、落ち着いた色" },
    { name: "作品のある空間", body: "{場面}。部屋の壁や棚にある様子、少し離れて。昼の自然光" },
  ],
  other: [
    { name: "やわらかい自然光", body: "{場面}。やわらかい自然光で、少し斜めから近く。背景はぼかし、人物は後ろ姿か手元だけ" },
    { name: "会場の雰囲気", body: "{場面}。会場の雰囲気、人物は後ろ姿。明るく親しみやすい色" },
  ],
};
