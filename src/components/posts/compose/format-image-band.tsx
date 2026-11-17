"use client";

import { Button } from "@/components/ui/button";
import { photoModel, photoUnitYen } from "@/lib/ai/photo";
import { formatPhotoTexts, hasUnfilled, type FormatImage } from "@/lib/post-formats/image";
import type { FormatUse } from "../post-format-picker";

// ③ 画像の上の帯: 選んでいる投稿のフォーマットに画像の設定があれば、穴の言葉を入れた絵の説明と「つくる」を出す（docs/design/format-image.md の 2.1）。
// 押したときだけ費用がかかる（オーナーの了承 F2）。「自分で場面を書く」は、絵の説明を入れて画像をつくる画面を開くだけ
export function FormatImageBand({
  use,
  disabled,
  onMake,
}: {
  use: FormatUse & { format: { image: FormatImage } };
  disabled: boolean;
  onMake: (auto: boolean, texts: { text: string; headline: string | null }) => void;
}) {
  const { format, values, answer } = use;
  const texts = formatPhotoTexts(format, values, answer);
  const left = hasUnfilled(texts.text) || (texts.headline !== null && hasUnfilled(texts.headline));
  // 1 枚の目安（押す前に出す）。AI が場面に直すときは、Claude の 1〜3 円を足す
  const unit = photoUnitYen(photoModel({}));
  const cost = format.image.scene === "ai" ? `約 ${unit + 1}〜${unit + 3} 円` : `約 ${unit} 円`;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line px-4 py-3 text-[13px] max-sm:px-3">
      <p className="font-bold">フォーマット「{format.name}」の画像</p>
      <details>
        <summary className="cursor-pointer text-xs text-muted">絵の説明を見る</summary>
        <p className="mt-1.5 rounded-md bg-surface2 px-3 py-2 leading-[1.7] whitespace-pre-wrap">{texts.text}</p>
        {texts.headline && <p className="mt-1 text-xs text-muted">重ねる見出し: {texts.headline}</p>}
      </details>
      {left && <p className="text-xs leading-[1.7]"><span className="mr-1.5 font-bold text-signal">● 要確認</span>【】のところは、「1 書く」でフォーマットの穴を埋めると入ります。</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="button" size="sm" disabled={disabled || left} onClick={() => onMake(true, texts)}>
          つくる（1 枚・{cost}）
        </Button>
        <Button type="button" variant="text" size="sm" disabled={disabled} onClick={() => onMake(false, texts)}>
          自分で場面を書く
        </Button>
      </div>
    </div>
  );
}
