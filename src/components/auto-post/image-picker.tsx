"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ErrorBanner } from "@/components/ui/feedback";
import { HelpTip } from "@/components/ui/help";
import { acknowledgePhoto } from "@/lib/ai/photo-actions";
import { AUTO_PHOTO_LIMITS } from "@/lib/ai/photo";
import type { AutoImage, AutoImageLook, AutoImageSize, AutoKind } from "@/lib/auto-post/types";
import { DEFAULT_BRAND_COLOR, DEFAULT_TEXT_STYLE, PALETTES } from "@/lib/media/templates";
import { loadTemplateStyle, StyleFields } from "@/components/posts/template-fields";

// 自動の回の画像を選ぶ（docs/design/auto-sample-image.md の 2.1。ウィザードの「どこに」）。
// 付けない／AI がつくる（本文から場面を考える）。シリーズでフォーマットに画像の設定があるときは選ばせず、いつもフォーマットのとおりにつくる
// （設定の要約とフォーマットの編集への入口だけ。値はウィザードが fitImageToFormat で決める。2026-11-20 オーナーの指摘）。
// 商品の紹介はイラストだけ（実物と違う商品を、本物の写真のように見せないため）。選んだら、AI の画像の注意を読んでもらう（DB も断る）

type Choice = "none" | "format" | "ai";

const SIZES: { key: AutoImageSize; label: string }[] = [
  { key: "auto", label: "送り先に合わせる" },
  { key: "portrait", label: "縦 4:5" },
  { key: "square", label: "正方形 1:1" },
  { key: "landscape", label: "横 16:9" },
];

export function ImagePicker(p: {
  projectId: string;
  kind: AutoKind;
  formatHasImage: boolean;
  formatHasHeadline: boolean;
  // シリーズのフォーマットの名前と、画像の設定の要約（「写真・縦 4:5・見出しあり」）
  formatName?: string;
  formatImageSpec?: string | null;
  // フォーマットの画面へ（戻ってこられるように back を付けたもの）
  formatsHref: string;
  value: AutoImage | null;
  onChange: (v: AutoImage | null) => void;
  photo: { enabled: boolean; acknowledged: boolean };
  onAcknowledged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [acking, startAck] = useTransition();
  const choice: Choice = p.value?.source ?? "none";
  const product = p.kind === "product";
  // シリーズで、フォーマットに画像の設定がある: 選ばせない（フォーマットのとおり）
  const byFormat = p.kind === "series" && p.formatHasImage;
  const pick = (c: Choice) => {
    if (c === "none") return p.onChange(null);
    // フォーマットの画像は、写真かイラスト・縦横もフォーマットのものを使う（ここの値は使わない）
    p.onChange({ source: c, style: product ? "illustration" : (p.value?.style ?? "illustration"), size: p.value?.size ?? "auto", headline: "none" });
  };
  // 見出しを重ねる（なし・フォーマットの見出し・AI が書く）。重ねるときは見た目も持つ（初めはこの端末で前に使った見た目）
  const setHeadline = (h: AutoImage["headline"]) => {
    if (!p.value) return;
    if (h === "none") {
      const { look: _drop, ...rest } = p.value;
      void _drop;
      return p.onChange({ ...rest, headline: "none" });
    }
    p.onChange({ ...p.value, headline: h, look: p.value.look ?? defaultLook(p.projectId) });
  };

  if (!p.photo.enabled) {
    return (
      <Card className="px-6 py-5 max-sm:px-4 max-sm:py-4">
        <p className="text-sm text-muted">画像を自動でつくる機能は準備中です（ネタ帳の写真つきのメモは、写真を添えます）。</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 px-6 py-5 max-sm:px-4 max-sm:py-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[16px] font-bold">画像</h2>
        <HelpTip label="画像について">
          画像を付けると、回ごとに AI で 1 枚つくって添えます（1 枚 約 5 円。AI が場面を考えるときは 約 7〜8 円）。自動の投稿の画像は 1 人 月 {AUTO_PHOTO_LIMITS.userMonthlyImages} 枚までです。画像をつくれなかった回は、送らずに下書きに回します。
        </HelpTip>
      </div>
      {byFormat && (
        <p className="text-sm">
          画像{p.formatHasHeadline ? "と見出し" : ""}は、フォーマット「{p.formatName}」の設定のとおりにつくります
          {p.formatImageSpec && <span className="num text-muted">（{p.formatImageSpec}）</span>}
          {" "}
          <Link href={p.formatsHref} className="whitespace-nowrap underline">
            フォーマットを編集 →
          </Link>
        </p>
      )}
      {p.kind === "series" && !p.formatHasImage && (
        <p className="text-sm text-muted">
          フォーマットに画像の設定がありません。{" "}
          <Link href={p.formatsHref} className="whitespace-nowrap underline">
            フォーマットで設定する →
          </Link>
        </p>
      )}
      {!byFormat && (
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="画像">
        <Chip on={choice === "none"} role="radio" aria-checked={choice === "none"} onClick={() => pick("none")}>
          付けない
        </Chip>
        <Chip on={choice === "ai"} role="radio" aria-checked={choice === "ai"} onClick={() => pick("ai")}>
          AI がつくる
        </Chip>
      </div>
      )}
      {choice === "none" && <p className="text-sm text-muted">{p.kind === "notes" ? "文だけで送ります（写真つきのメモは、写真を添えます）。" : "文だけで送ります。"}</p>}
      {choice === "ai" && p.value && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">その回の文から、AI が場面を考えてつくります。</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm text-muted">描き方</span>
            <div className="flex gap-1.5" role="radiogroup" aria-label="描き方">
              <Chip on={p.value.style === "photo"} role="radio" aria-checked={p.value.style === "photo"} disabled={product} onClick={() => p.onChange({ ...p.value!, style: "photo" })}>
                写真のように
              </Chip>
              <Chip on={p.value.style === "illustration"} role="radio" aria-checked={p.value.style === "illustration"} onClick={() => p.onChange({ ...p.value!, style: "illustration" })}>
                イラストで
              </Chip>
            </div>
          </div>
          {product && <p className="text-sm text-muted">商品・サービスの紹介では、イラストだけです（実物と違う商品を、本物の写真のように見せないため）。</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm text-muted">縦横</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="縦横">
              {SIZES.map((s) => (
                <Chip key={s.key} on={p.value!.size === s.key} role="radio" aria-checked={p.value!.size === s.key} onClick={() => p.onChange({ ...p.value!, size: s.key })}>
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      )}
      {choice === "ai" && p.value && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm text-muted">見出し</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="見出しを重ねる">
              <Chip on={p.value.headline === "none"} role="radio" aria-checked={p.value.headline === "none"} onClick={() => setHeadline("none")}>
                重ねない
              </Chip>
              <Chip on={p.value.headline === "ai"} role="radio" aria-checked={p.value.headline === "ai"} onClick={() => setHeadline("ai")}>
                AI が書く
              </Chip>
            </div>
          </div>
          {p.value.headline !== "none" && (
            <>
              <p className="text-sm text-muted">
                その回の文に合う見出しを AI が書いて、画像に重ねます（20 字ほど）。
                絵文字は描けないので、取り除いて描きます。
              </p>
              <StyleFields style={p.value.look ?? defaultLook(p.projectId)} onStyle={(patch) => p.onChange({ ...p.value!, look: { ...(p.value!.look ?? defaultLook(p.projectId)), ...patch } })} showTextStyle />
            </>
          )}
        </div>
      )}
      {choice !== "none" && !p.photo.acknowledged && (
        <div className="flex flex-col gap-3 rounded-md border border-line bg-surface2 px-4 py-3.5 text-sm leading-[1.8]">
          <p className="font-bold">AI でつくる画像について（はじめの 1 回だけ出します）</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>作った画像には「AI で作った画像」の印を付けます。Threads・Instagram・X には、送るときに「AI で作った」ことの印も付けます（Facebook は付ける欄がありません）。</li>
            <li>実在の人に似せたり、自分の商品・お店・顧客を本物の写真のように見せたりすると、見た人の誤解を招いたり、景品表示法（実際よりよく見せる表示）の問題になったりすることがあります。</li>
            <li>絵の説明は、画像をつくる Google に送ります（学習には使われません）。自動の投稿では、あなたがその場で押していないときにも送ります。</li>
          </ul>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <Button
            type="button"
            size="sm"
            className="self-start"
            disabled={acking}
            onClick={() =>
              startAck(async () => {
                const r = await acknowledgePhoto();
                if (r.error) setError(r.error);
                else p.onAcknowledged();
              })
            }
          >
            わかりました
          </Button>
        </div>
      )}
    </Card>
  );
}

// 見出しの見た目の初め: この端末で前に「文字を入れる」で使った見た目（なければ 藍・すっきり・左に控えめ）
function defaultLook(projectId: string): AutoImageLook {
  const s = typeof window === "undefined" ? null : loadTemplateStyle(projectId);
  const palette = s && [...PALETTES.map((p) => p.key), "brand"].includes(s.palette) ? s.palette : PALETTES[0].key;
  return { palette, brand: s?.brand && /^#[0-9a-fA-F]{6}$/.test(s.brand) ? s.brand : DEFAULT_BRAND_COLOR, font: s?.font ?? "gothic", textStyle: s?.textStyle ?? DEFAULT_TEXT_STYLE };
}
