import type { AutoImage, AutoKind } from "./types";

// シリーズの回の画像を、フォーマットの画像の設定に合わせる（2026-11-20 オーナーの指摘「フォーマットで画像の細かい設定をしているのに、
// なぜ自動の投稿で、画像を付けるか・AI が作るかの選択肢が出てくるの？」）。ウィザードと保存のサーバーの操作が同じ関数を使う。
// - フォーマットに画像の設定がある: いつもフォーマットのとおりにつくる（source=format。見出しはフォーマットに見出しがあれば format、なければ none）。
//   写真かイラスト・縦横はフォーマットのものを使う（ここの style・size は使わない）。見出しの見た目は、前に選んでいたものがあれば残す
// - フォーマットに画像の設定がない: 「フォーマットの画像」は選べない（付けない・AI がつくるだけ）
// - シリーズ以外・画像をつくれないとき（鍵がない）: そのまま
export type FormatImageInfo = { hasImage: boolean; hasHeadline: boolean };

export function fitImageToFormat(kind: AutoKind | null, format: FormatImageInfo | null, image: AutoImage | null, photoEnabled: boolean): AutoImage | null {
  if (kind !== "series" || !photoEnabled || !format) return image;
  if (!format.hasImage) return image?.source === "format" ? null : image;
  const headline = format.hasHeadline ? "format" : "none";
  return { source: "format", style: "illustration", size: "auto", headline, ...(headline === "format" && image?.look ? { look: image.look } : {}) };
}
