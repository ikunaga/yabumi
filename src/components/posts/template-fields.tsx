"use client";

import { useEffect, useState } from "react";
import { AiThinking } from "@/components/ui/ai-thinking";
import { Button, NotReadyButton } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import type { ImageBrief } from "@/lib/ai/image-brief";
import { FONT_CLASS } from "@/lib/media/template-fonts";
import {
  DEFAULT_BRAND_COLOR,
  DEFAULT_TEXT_STYLE,
  FONT_KEYS,
  FONT_LABEL,
  PALETTES,
  PHOTO_FITS,
  PHOTO_FIT_LABEL,
  TEMPLATE_KIND_LABEL,
  TEMPLATE_SIZES,
  TEXT_STYLES,
  TEXT_STYLE_LABEL,
  fontKeyOf,
  textStyleOf,
  type FontKey,
  type PhotoFit,
  type TemplateSizeKey,
  type TextStyle,
} from "@/lib/media/templates";
import { Choice, Group } from "./maker-parts";

// 画像の文字の欄（画像をつくる画面のテンプレートと、添えた画像に見出しを付ける欄で使う）

export type TemplateStyle = { palette: string; brand: string; font: FontKey; textStyle: TextStyle };
const storageKey = (projectId: string) => `yabumi-template:${projectId}`;

// 前に覚えた書体がやめた書体（力強い）なら、近い書体に読み替える。置き方を覚えていなければ（前の版）既定の置き方
export function loadTemplateStyle(projectId: string): TemplateStyle | null {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "null");
    const font = fontKeyOf(v?.font);
    if (!v || typeof v.palette !== "string" || typeof v.brand !== "string" || !font) return null;
    return { palette: v.palette, brand: v.brand, font, textStyle: textStyleOf(v.textStyle) };
  } catch {
    return null;
  }
}

// 色と書体は、プロジェクトごとに前回のものを覚えておく（この端末だけ。この欄はブラウザでだけ描くので、最初から読める）
export function useTemplateStyle(projectId: string, initial?: TemplateStyle) {
  const [style, setStyle] = useState<TemplateStyle>(
    () => initial ?? loadTemplateStyle(projectId) ?? { palette: PALETTES[0].key, brand: DEFAULT_BRAND_COLOR, font: "gothic", textStyle: DEFAULT_TEXT_STYLE },
  );
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(projectId), JSON.stringify(style));
    } catch {
      // 保存できなくても描くのは続ける
    }
  }, [projectId, style]);
  return [style, (patch: Partial<TemplateStyle>) => setStyle((s) => ({ ...s, ...patch }))] as const;
}

// AI に文字の案を出してもらう帯
export function BriefBar({ aiEnabled, hasText, drafting, brief, onDraft }: { aiEnabled: boolean; hasText: boolean; drafting: boolean; brief: ImageBrief | null; onDraft: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface2 px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {aiEnabled ? (
          <Button type="button" variant="secondary" size="sm" disabled={drafting || !hasText} onClick={onDraft}>
            {drafting ? "考えています…" : brief ? "別の案を出してもらう" : "AI に文字の案を出してもらう"}
          </Button>
        ) : (
          <NotReadyButton variant="secondary" size="sm">
            AI に文字の案を出してもらう
          </NotReadyButton>
        )}
        <span className="text-xs text-muted">{hasText ? "本文とアカウント設計から考えます（1 回 2 円ほど）" : "本文を書くと、AI が画像の文字を考えます"}</span>
      </div>
      {drafting && <AiThinking kind="brief" note="10〜20 秒ほどかかります" />}
      {brief && (
        <p className="leading-[1.7]">
          <span className="mr-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">AI のおすすめ</span>
          {TEMPLATE_KIND_LABEL[brief.recommend]}。{brief.reason}
        </p>
      )}
    </div>
  );
}

export function LabelField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[14px] font-bold">
        ラベル<span className="ml-1.5 text-xs font-normal text-muted">任意。例: 新機能、お知らせ</span>
      </span>
      <Input value={value} maxLength={12} onChange={(e) => onChange(e.target.value)} className="py-2" />
    </label>
  );
}

// 見出し・AI の見出しの案・補足
export function HeadlineFields({
  headline,
  subline,
  brief,
  onHeadline,
  onSubline,
}: {
  headline: string;
  subline: string;
  brief: ImageBrief | null;
  onHeadline: (v: string) => void;
  onSubline: (v: string) => void;
}) {
  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="text-[14px] font-bold">見出し</span>
        <Textarea value={headline} rows={2} maxLength={40} onChange={(e) => onHeadline(e.target.value)} className="py-2" />
        <span className="text-xs text-muted">22 字くらいまでが、ひと目で読めます。改行も使えます</span>
      </label>
      {brief && brief.headlines.length > 1 && (
        <Group label="AI の見出しの案">
          {brief.headlines.map((h) => (
            <Choice key={h} on={headline === h} onClick={() => onHeadline(h)} className="text-left">
              {h}
            </Choice>
          ))}
        </Group>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-[14px] font-bold">
          補足<span className="ml-1.5 text-xs font-normal text-muted">任意</span>
        </span>
        <Input value={subline} maxLength={60} onChange={(e) => onSubline(e.target.value)} className="py-2" />
      </label>
    </>
  );
}

export function FooterField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[14px] font-bold">
        下に小さく出す名前<span className="ml-1.5 text-xs font-normal text-muted">任意</span>
      </span>
      <Input value={value} maxLength={30} onChange={(e) => onChange(e.target.value)} className="py-2" />
    </label>
  );
}

export function SizeField({ size, hint, onSize }: { size: TemplateSizeKey; hint?: string; onSize: (s: TemplateSizeKey) => void }) {
  return (
    <Group label="縦横" hint={hint}>
      {(Object.keys(TEMPLATE_SIZES) as TemplateSizeKey[]).map((s) => (
        <Choice key={s} on={size === s} onClick={() => onSize(s)}>
          {TEMPLATE_SIZES[s].label}
        </Choice>
      ))}
    </Group>
  );
}

export function PhotoFitField({ value, onChange }: { value: PhotoFit; onChange: (v: PhotoFit) => void }) {
  return (
    <Group label="写真の置き方">
      {PHOTO_FITS.map((f) => (
        <Choice key={f} on={value === f} onClick={() => onChange(f)}>
          {PHOTO_FIT_LABEL[f]}
        </Choice>
      ))}
    </Group>
  );
}

// 色・文字の置き方（showTextStyle のときだけ）・文字の形
export function StyleFields({ style, onStyle, showTextStyle }: { style: TemplateStyle; onStyle: (patch: Partial<TemplateStyle>) => void; showTextStyle: boolean }) {
  return (
    <>
      <Group label="色">
        {PALETTES.map((p) => (
          <Choice key={p.key} on={style.palette === p.key} onClick={() => onStyle({ palette: p.key })} className="inline-flex items-center gap-1.5">
            {/* 画像の中身の色の見本（画面の色ではない） */}
            <span aria-hidden className="inline-block size-4 rounded-full border border-line" style={{ background: `linear-gradient(135deg, ${p.bg} 55%, ${p.accent} 55%)` }} />
            {p.label}
          </Choice>
        ))}
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${style.palette === "brand" ? "border-primary bg-primary-soft font-bold text-primary" : "border-border"}`}>
          <input
            type="color"
            aria-label="いつもの色を選ぶ"
            value={style.brand}
            onChange={(e) => onStyle({ brand: e.target.value, palette: "brand" })}
            className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          <button type="button" aria-pressed={style.palette === "brand"} onClick={() => onStyle({ palette: "brand" })}>
            いつもの色
          </button>
        </span>
      </Group>

      {showTextStyle && (
        <Group label="文字の置き方">
          {TEXT_STYLES.map((t) => (
            <Choice key={t} on={style.textStyle === t} onClick={() => onStyle({ textStyle: t })}>
              {TEXT_STYLE_LABEL[t]}
            </Choice>
          ))}
        </Group>
      )}

      <Group label="文字の形" hint="日本語の書体は、使う字のぶんだけ読み込みます">
        {FONT_KEYS.map((f) => (
          <Choice key={f} on={style.font === f} onClick={() => onStyle({ font: f })} className={FONT_CLASS[f]}>
            {FONT_LABEL[f]}
          </Choice>
        ))}
      </Group>
    </>
  );
}
