"use client";

import { useEffect, useRef, useState } from "react";
import { Input, Textarea } from "@/components/ui/field";
import { PHOTO_STYLES, PHOTO_STYLE_LABEL, SCENE_YEN, photoModel, photoUnitYen } from "@/lib/ai/photo";
import { TEMPLATE_SIZES } from "@/lib/media/templates";
import { listRecentScenes } from "@/lib/ai/photo-actions";
import { IMAGE_SCENES, IMAGE_SCENE_LABEL, IMAGE_SIZES, MAX_IMAGE_HEADLINE, MAX_IMAGE_LABEL, MAX_IMAGE_PROMPT, imageSlotNames, needsAiScene, usesAnswer, type FormatImage } from "@/lib/post-formats/image";
import type { FormatSeries } from "@/lib/post-formats/series";
import { Choice } from "./maker-parts";
import { loadTemplateStyle, StyleFields } from "./template-fields";
import { DEFAULT_LOOK, readLook, type HeadlineLook } from "@/lib/media/look";
import { DisclosureBox } from "@/components/ui/disclosure";

const SIZE_LABEL = (s: FormatImage["size"]) => (s === "auto" ? "送る SNS に合わせる" : TEMPLATE_SIZES[s].label);

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
  // 前に使った絵の説明（添えた AI の画像の説明から。絵の説明のフォーマットの代わり。2026-11-21 オーナーの決定）
  const [recent, setRecent] = useState<string[]>([]);
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

  // 「前に使った絵の説明から選ぶ」の一覧（開いたときに 1 回読む）
  useEffect(() => {
    let alive = true;
    void listRecentScenes(projectId).then((r) => {
      if (alive && r.scenes) setRecent(r.scenes);
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
    <DisclosureBox label="画像の設定を表示" className="text-xs" open={image.prompt.trim() ? true : undefined}>
      <div className="flex flex-col gap-3">
        <p className="text-muted">決めておくと、「投稿をつくる」の「3 画像・動画」で、押すだけで画像をつくれます。</p>
        <label className="flex flex-col gap-1">
          <span className="font-bold">絵の説明</span>
          {names.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted">押すと、その空欄を絵の説明に入れます</span>
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
          {recent.length > 0 && (
            <select
              aria-label="前に使った絵の説明から選ぶ"
              value=""
              onChange={(e) => {
                const s = recent[Number(e.target.value)];
                if (s) setPrompt([...s].slice(0, MAX_IMAGE_PROMPT).join(""));
              }}
              className="self-start rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm max-sm:text-[16px]"
            >
              <option value="">前に使った絵の説明から選ぶ</option>
              {recent.map((s, i) => (
                <option key={s} value={i}>
                  {[...s].length > 40 ? `${[...s].slice(0, 40).join("")}…` : s}
                </option>
              ))}
            </select>
          )}
          {/* ui-wording-ignore: {場面} は、前の絵の説明のフォーマット（2026-11-21 に廃止）から写した文に残っていることがある差し込みの名前（データ） */}
          {image.prompt.includes("{場面}") && !names.includes("場面") && <span className="font-bold text-signal">{"{場面}"} は、ここでは使えません。上の空欄の {`{${names[0] ?? "キーワード"}}`} などか、言葉に書き換えてください</span>}
          {usesAnswer(image.prompt, body, series) && <span className="text-muted">クイズでは、絵で答えがわかってしまうことがあります。答えの空欄は、絵の説明に入れないでください。</span>}
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
              ? `空欄の言葉をもとに、AI が絵の説明を書きます。たとえば、苺・雪・朝から「雪の朝、窓辺の苺のケーキ」と書きます。作品の題名や人物が、そのまま絵にならないようにします。画像 1 枚につき、費用が ${SCENE_YEN.one[0]}〜${SCENE_YEN.one[1]} 円ほど増えます。`
              : "書いた絵の説明に空欄の言葉を入れて、そのまま画像をつくります。費用は増えません。"}
          </p>
          {scene === "fill" && risky && (
            <p className="font-semibold leading-[1.7] text-signal">
              ● 作品の題名やキャラクターが、そのまま絵になることがあります。他人の作品に似た画像は、著作権の問題になることがあります。画像をつくれないこともあります。心配なら「空欄の言葉から AI が絵の説明を書く」を選んでください。
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
          <legend className="mb-1 font-bold">画像に文字を重ねる</legend>
          <div className="flex flex-wrap gap-2">
            <Choice on={image.headline === null} onClick={() => setImage({ ...image, headline: null, label: null, look: null })}>
              なし
            </Choice>
            <Choice on={image.headline !== null} onClick={() => setImage({ ...image, headline: image.headline ?? "" })}>
              あり
            </Choice>
          </div>
          {image.headline !== null && (
            <>
              {/* 見出しを 2 段にする（2026-11-20 オーナーの指示）。上の小さい文は色の文字で、見出しの半分くらいの大きさで描く */}
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold">画像の小さい文字</span>
                <span className="text-xs text-muted">書かなくてもかまいません。{MAX_IMAGE_LABEL} 字まで書けます。{"{ }"} の空欄も使えます。</span>
                <span className="text-xs text-muted">画像の文字の上に、小さな色付きの字で入ります。</span>
                <Input
                  aria-label="画像の小さい文字"
                  value={image.label ?? ""}
                  maxLength={MAX_IMAGE_LABEL}
                  onChange={(e) => setImage({ ...image, label: e.target.value })}
                  placeholder="例: 今週のおすすめ"
                  className="py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold">画像の文字</span>
                <span className="text-xs text-muted">{MAX_IMAGE_HEADLINE} 字まで書けます。{"{ }"} の空欄には、本文の空欄と同じ言葉が入ります。</span>
                <Input
                  aria-label="画像の文字"
                  value={image.headline}
                  maxLength={MAX_IMAGE_HEADLINE}
                  onChange={(e) => setImage({ ...image, headline: e.target.value })}
                  placeholder="例: {パン}が焼きあがりました"
                  className="py-2 text-sm"
                />
              </label>
              {/* 見出しの見た目（色・書体・置き方）。「文字を入れる」と同じ部品。自動の投稿も、この見た目でつくる */}
              <div className="flex flex-col gap-2 border-t border-line pt-3">
                <span className="text-xs font-bold">見出しの見た目</span>
                <span className="text-xs text-muted">このフォーマットの画像には、見出しがこの見た目で入ります。自動投稿も同じです。投稿をつくるときは、あとから変えられます。</span>
                <StyleFields style={image.look ?? defaultLook(projectId)} onStyle={(patch) => setImage({ ...image, look: { ...(image.look ?? defaultLook(projectId)), ...patch } })} showTextStyle />
              </div>
            </>
          )}
        </fieldset>

        <p className="leading-[1.7] text-muted">
          {scene === "ai" ? `画像は 1 枚 約 ${unit} 円です。AI が絵の説明も書くので、合わせて約 ${unit + SCENE_YEN.one[0]}〜${unit + SCENE_YEN.one[1]} 円です。` : `画像は 1 枚 約 ${unit} 円です。`}
          お金は「つくる」を押したときだけかかります。
        </p>
      </div>
    </DisclosureBox>
  );
}

// 見出しの見た目の初め: この端末で前に「文字を入れる」で使った見た目（なければ 藍・すっきり・左に控えめ）
function defaultLook(projectId: string): HeadlineLook {
  return (typeof window === "undefined" ? null : readLook(loadTemplateStyle(projectId))) ?? DEFAULT_LOOK;
}
