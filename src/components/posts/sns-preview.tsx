"use client";

import { useState } from "react";
import { SNS, ignoresImages, type SnsKey } from "@/lib/sns";
import { PREVIEW, foldText, previewSegments } from "@/lib/sns/preview";
import type { AttachedImage } from "./image-attachments";

type Props = {
  sns: SnsKey;
  text: string;
  title: string | null;
  projectName: string;
  images: AttachedImage[];
  // 字数（SNS の数え方。checkTarget の length）
  length: number;
};

// 1 つの SNS での見え方（投稿をつくる画面の右）。改行・長さ・画像の並び・折りたたみ・字数の上限が SNS ごとにわかるように。
// 切り替えたら折りたたみを戻すため、呼ぶ側で key={sns} を付ける
export function SnsPreview({ sns, text, title, projectName, images, length }: Props) {
  const spec = PREVIEW[sns];
  const [expanded, setExpanded] = useState(false);
  const max = SNS[sns].maxLength;
  const shownImages = ignoresImages(sns) ? [] : images.filter((i) => i.previewUrl).slice(0, SNS[sns].maxImages);
  const { shown, folded } = foldText(text, expanded ? null : spec.fold);

  const body = text ? (
    <p className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
      {sns === "instagram" && <b className="mr-1.5">{projectName}</b>}
      <Rich text={shown} />
      {folded && (
        <>
          …{" "}
          <button type="button" onClick={() => setExpanded(true)} className="text-muted hover:underline">
            {spec.fold!.more}
          </button>
        </>
      )}
    </p>
  ) : (
    <p className="text-muted">（本文なし）</p>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-surface p-3.5 text-sm leading-[1.6]">
        {spec.layout !== "article" && (
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="size-9 flex-none rounded-full bg-primary-soft" />
            <b className="min-w-0 truncate">{projectName}</b>
          </div>
        )}
        {spec.layout === "before" && <Images images={shownImages} layout="before" />}
        {spec.layout === "video" && (
          <div className={`flex items-center justify-center rounded-md bg-surface2 text-xs text-muted ${sns === "tiktok" ? "mx-auto aspect-[9/16] w-1/2" : "aspect-video w-full"}`}>
            動画（添付は準備中）
          </div>
        )}
        {spec.layout === "article" ? (
          <div className="flex flex-col gap-2">
            <b className="text-lg leading-snug break-words">{title || <span className="text-muted">（タイトルなし）</span>}</b>
            <span className="text-xs text-muted">{projectName}</span>
            {body}
          </div>
        ) : (
          body
        )}
        {spec.layout === "after_grid" && <Images images={shownImages} layout="grid" />}
        {spec.layout === "after_row" && <Images images={shownImages} layout="row" />}
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className={max !== null && length > max ? "font-bold text-danger" : "text-muted"}>
          {length.toLocaleString("ja-JP")}
          {max !== null ? ` / ${max.toLocaleString("ja-JP")} 字` : " 字（上限なし）"}
        </span>
        {max !== null && length > max && <span className="font-bold text-danger">{(length - max).toLocaleString("ja-JP")} 字多いので送れません</span>}
      </p>
      <p className="text-xs leading-[1.7] text-muted">{spec.note}</p>
    </div>
  );
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {previewSegments(text).map((s, i) => (s.kind === "text" ? <span key={i}>{s.value}</span> : <span key={i} className="text-primary">{s.value}</span>))}
    </>
  );
}

function Images({ images, layout }: { images: AttachedImage[]; layout: "before" | "grid" | "row" }) {
  if (images.length === 0) return null;
  const alt = (image: AttachedImage, i: number) => image.altText || `${i + 1} 枚目の画像`;
  if (layout === "before") {
    // Instagram: 1 枚目を大きく、残りはめくって見る（枚数だけ出す）
    return (
      <div className="relative -mx-3.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- 署名つきの URL は期限があり、next/image の最適化を通さない */}
        <img src={images[0].previewUrl!} alt={alt(images[0], 0)} className="aspect-[4/5] w-full object-cover" />
        {images.length > 1 && <span className="absolute top-2 right-2 rounded-full bg-scrim px-2 py-0.5 text-xs text-on-primary">1 / {images.length}</span>}
      </div>
    );
  }
  if (layout === "row") {
    return (
      <div className="flex gap-1.5 overflow-x-auto">
        {images.map((image, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- 同上
          <img key={image.id} src={image.previewUrl!} alt={alt(image, i)} className="h-36 w-28 flex-none rounded-md object-cover" />
        ))}
      </div>
    );
  }
  return (
    <div className={`grid gap-0.5 overflow-hidden rounded-xl border border-line ${images.length > 1 ? "grid-cols-2" : ""}`}>
      {images.slice(0, 4).map((image, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- 同上
        <img
          key={image.id}
          src={image.previewUrl!}
          alt={alt(image, i)}
          className={`w-full object-cover ${images.length === 1 ? "aspect-video" : images.length === 3 && i === 0 ? "row-span-2 h-full" : "aspect-square"}`}
        />
      ))}
    </div>
  );
}
