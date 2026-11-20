"use client";

import { useEffect, useRef, useState } from "react";
import { Input, Textarea } from "@/components/ui/field";
import { PHOTO_STYLES, PHOTO_STYLE_LABEL, SCENE_YEN, photoModel, photoUnitYen } from "@/lib/ai/photo";
import { TEMPLATE_SIZES } from "@/lib/media/templates";
import { listPhotoTemplates } from "@/lib/photo-templates/actions";
import type { PhotoTemplate } from "@/lib/photo-templates/schema";
import { IMAGE_SCENES, IMAGE_SCENE_LABEL, IMAGE_SIZES, MAX_IMAGE_HEADLINE, MAX_IMAGE_PROMPT, imageSlotNames, needsAiScene, usesAnswer, type FormatImage } from "@/lib/post-formats/image";
import type { FormatSeries } from "@/lib/post-formats/series";
import { Choice } from "./maker-parts";

const SIZE_LABEL = (s: FormatImage["size"]) => (s === "auto" ? "送り先に合わせる" : TEMPLATE_SIZES[s].label);

// フォーマットの編集の「画像」（docs/design/format-image.md の 1.・4.）。絵の説明（穴と答えを使える）・場面のつくり方・描き方・縦横・重ねる見出し。
// 絵の説明が空なら画像なし。保存の形とそろえ方の正はサーバー（store.ts の checkFormat）
export function FormatImageFields({
  projectId,
  body,
  series,
  image,
  setImage,
}: {
  projectId: string;
  body: string;
  series: FormatSeries;
  image: FormatImage;
  setImage: (img: FormatImage) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const names = imageSlotNames(body, series);
  // 答えか AI の空欄を使うか。初めは「AI が絵の説明を書く」を選んでおく（利用者が選んだあとは変えない）。固定はしない（2026-11-20）
  const risky = needsAiScene(image, body, series);
  const [picked, setPicked] = useState(false);
  const scene = image.scene;
  function setPrompt(prompt: string) {
    const next = { ...image, prompt };
    setImage(!picked && !risky && next.scene === "fill" && needsAiScene(next, body, series) ? { ...next, scene: "ai" } : next);
  }
  const unit = photoUnitYen(photoModel({}));

  // 「絵の説明のフォーマットから写す」の一覧（開いたときに 1 回読む）
  useEffect(() => {
    let alive = true;
    void listPhotoTemplates(projectId).then((r) => {
      if (alive && r.templates) setTemplates(r.templates);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  // 穴のチップ: 押すと、絵の説明のカーソルの位置に {穴} を差し込む
  function insertSlot(name: string) {
    const el = ref.current;
    const at = el ? el.selectionStart : image.prompt.length;
    const end = el ? el.selectionEnd : at;
    const next = `${image.prompt.slice(0, at)}{${name}}${image.prompt.slice(end)}`;
    setPrompt([...next].slice(0, MAX_IMAGE_PROMPT).join(""));
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + name.length + 2;
      el?.setSelectionRange(pos, pos);
    });
  }

  return (
    <details className="text-xs" open={image.prompt.trim() ? true : undefined}>
      <summary className="cursor-pointer font-bold">
        画像も決めておく<span className="ml-1.5 font-normal text-muted">任意・投稿をつくるの「3 画像」で、押すだけでつくれます</span>
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-bold">絵の説明</span>
          {names.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted">押すと差し込みます</span>
              {names.map((n) => (
                <button key={n} type="button" onClick={() => insertSlot(n)} className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs hover:border-primary">
                  {`{${n}}`}
                </button>
              ))}
            </span>
          )}
          <Textarea
            ref={ref}
            value={image.prompt}
            rows={3}
            maxLength={MAX_IMAGE_PROMPT}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例: {キーワード}を思わせる小物が、木の机の上に並んでいる。真上から、やわらかい自然光"
            className="py-2 text-sm"
          />
          {templates.length > 0 && (
            <select
              aria-label="絵の説明のフォーマットから写す"
              value=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                if (t) setPrompt([...t.body].slice(0, MAX_IMAGE_PROMPT).join(""));
              }}
              className="self-start rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm max-sm:text-[16px]"
            >
              <option value="">絵の説明のフォーマットから写す</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {image.prompt.includes("{場面}") && !names.includes("場面") && <span className="font-bold text-signal">{"{場面}"} を、上の空欄（例: {`{${names[0] ?? "キーワード"}}`}）か言葉に書き換えてください</span>}
          {usesAnswer(image.prompt, body, series) && <span className="text-muted">クイズでは、絵で答えがわかってしまうことがあります。</span>}
        </label>

        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1 font-bold">絵の説明のつくり方</legend>
          <div className="flex flex-wrap gap-2">
            {IMAGE_SCENES.map((s) => (
              <Choice
                key={s}
                on={scene === s}
                onClick={() => {
                  setPicked(true);
                  setImage({ ...image, scene: s });
                }}
              >
                {IMAGE_SCENE_LABEL[s]}
              </Choice>
            ))}
          </div>
          <p className="leading-[1.7] text-muted">
            {scene === "ai"
              ? `空欄の言葉から、AI が描く場面を考えて書きます（例: 苺・雪・朝 →「雪の朝、窓辺に置いた苺のケーキ」）。作品の題名や登場人物を、そのまま描かないためです。1 枚あたり約 ${SCENE_YEN.one[0]}〜${SCENE_YEN.one[1]} 円ふえます。`
              : "空欄の言葉を入れた絵の説明を、そのまま画像の AI に渡します。"}
          </p>
          {scene === "fill" && risky && (
            <p className="font-semibold leading-[1.7] text-signal">
              ● 作品の題名やキャラクターが、そのまま絵になることがあります。他人の作品に似た画像は、著作権などの問題になることがあり、画像の AI に断られることもあります。
            </p>
          )}
        </fieldset>

        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1 font-bold">描き方</legend>
          <div className="flex flex-wrap gap-2">
            {PHOTO_STYLES.map((s) => (
              <Choice key={s} on={image.style === s} onClick={() => setImage({ ...image, style: s })}>
                {PHOTO_STYLE_LABEL[s]}
              </Choice>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1 font-bold">縦横</legend>
          <div className="flex flex-wrap gap-2">
            {IMAGE_SIZES.map((s) => (
              <Choice key={s} on={image.size === s} onClick={() => setImage({ ...image, size: s })}>
                {SIZE_LABEL(s)}
              </Choice>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1 font-bold">見出しを重ねる</legend>
          <div className="flex flex-wrap gap-2">
            <Choice on={image.headline === null} onClick={() => setImage({ ...image, headline: null })}>
              なし
            </Choice>
            <Choice on={image.headline !== null} onClick={() => setImage({ ...image, headline: image.headline ?? "" })}>
              あり
            </Choice>
          </div>
          {image.headline !== null && (
            <Input
              aria-label="見出しの文"
              value={image.headline}
              maxLength={MAX_IMAGE_HEADLINE}
              onChange={(e) => setImage({ ...image, headline: e.target.value })}
              placeholder="例: 連想映画クイズ（{ } で空欄も使えます）"
              className="py-2 text-sm"
            />
          )}
        </fieldset>

        <p className="leading-[1.7] text-muted">
          つくるときに 1 枚 約 {unit} 円{scene === "ai" ? `（AI が絵の説明を書くので、合わせて 約 ${unit + SCENE_YEN.one[0]}〜${unit + SCENE_YEN.one[1]} 円）` : ""}。「つくる」を押したときだけかかります。
        </p>
      </div>
    </details>
  );
}
