"use client";

import { Button } from "@/components/ui/button";
import { SCENE_YEN, photoModel, photoUnitYen } from "@/lib/ai/photo";
import { formatPhotoTexts, hasUnfilled, type FormatImage } from "@/lib/post-formats/image";
import type { FormatUse } from "../post-format-picker";
import { DisclosureBox } from "@/components/ui/disclosure";

// ③ 画像の上の帯: 選んでいる投稿のフォーマットに画像の設定があれば、穴の言葉を入れた絵の説明と「つくる」を出す（docs/design/format-image.md の 2.1）。
// 押したときだけ費用がかかる（オーナーの了承 F2）。「自分で場面を書く」は、絵の説明を入れて画像をつくる画面を開くだけ
export function FormatImageBand({
  use,
  disabled,
  onMake,
}: {
  use: FormatUse & { format: { image: FormatImage } };
  disabled: boolean;
  onMake: (auto: boolean, texts: { text: string; headline: string | null; label: string | null }) => void;
}) {
  const { format, values } = use;
  const texts = formatPhotoTexts(format, values);
  const left = hasUnfilled(texts.text) || (texts.headline !== null && hasUnfilled(texts.headline)) || (texts.label !== null && hasUnfilled(texts.label));
  // 1 枚の目安（押す前に出す）。AI が場面に書き換えるときは、Claude の場面の分（SCENE_YEN.one）を足す
  const unit = photoUnitYen(photoModel({}));
  const cost = format.image.scene === "ai" ? `約 ${unit + SCENE_YEN.one[0]}〜${unit + SCENE_YEN.one[1]} 円` : `約 ${unit} 円`;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line px-4 py-3 text-[13px] max-sm:px-3">
      <p className="font-bold">フォーマット「{format.name}」で決めた画像</p>
      <DisclosureBox label="絵の説明を表示">
        <p className="rounded-md bg-surface2 px-3 py-2 leading-[1.7] whitespace-pre-wrap">{texts.text}</p>
        {texts.headline && (
          <p className="mt-1 text-xs text-muted">
            画像の文字: {texts.label && <span>{texts.label} ／ </span>}
            {texts.headline}
          </p>
        )}
      </DisclosureBox>
      {left && <p className="text-xs leading-[1.7]"><span className="mr-1.5 font-bold text-signal">● 要確認</span>【】のところには、「1 書く」で空欄に入れた言葉が入ります。</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="button" size="sm" disabled={disabled || left} onClick={() => onMake(true, texts)}>
          1 枚つくる・{cost}
        </Button>
        <Button type="button" variant="text" size="sm" disabled={disabled} onClick={() => onMake(false, texts)}>
          絵の説明を自分で書く
        </Button>
      </div>
    </div>
  );
}
