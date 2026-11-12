"use client";

import { useState } from "react";
import { SNS, ignoresImages, type SnsKey } from "@/lib/sns";
import { PREVIEW, foldText, previewImageLayout, previewName, previewSegments } from "@/lib/sns/preview";
import { PLACEHOLDER_CODE } from "@/lib/links/rules";
import { SNS_COLOR } from "@/components/ui/marks";
import type { AttachedImage } from "./image-attachments";

type Props = {
  sns: SnsKey;
  text: string;
  title: string | null;
  projectName: string;
  images: AttachedImage[];
  // 字数（SNS の数え方。checkTarget の length）
  length: number;
  // つないだアカウントの表示名と @handle（つないでいなければ、プロジェクトの名前を出す）
  account?: { name: string; handle: string } | null;
};

// 1 つの SNS での見え方（投稿をつくる画面の右のタブの中。出方の説明は呼ぶ側の「?」に畳む）。改行・長さ・画像の並び・折りたたみ・字数の上限が SNS ごとにわかるように。
// 切り替えたら折りたたみを戻すため、呼ぶ側で key={sns} を付ける
export function SnsPreview({ sns, text, title, projectName, images, length, account = null }: Props) {
  const spec = PREVIEW[sns];
  const [expanded, setExpanded] = useState(false);
  const max = SNS[sns].maxLength;
  const shownImages = ignoresImages(sns) ? [] : images.filter((i) => i.previewUrl).slice(0, SNS[sns].maxImages);
  const { shown, folded } = foldText(text, expanded ? null : spec.fold);
  const who = previewName(sns, projectName, account);

  const body = text ? (
    <p className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
      {sns === "instagram" && <b className="mr-1.5">{who.name}</b>}
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
      <div className="flex flex-col gap-2.5 overflow-hidden text-[15px] leading-[1.65]">
        {spec.layout !== "article" && (
          <div className="flex items-center gap-2.5">
            <span aria-hidden className={`size-8 flex-none rounded-full ${SNS_COLOR[sns].bg}`} />
            <b className="min-w-0 truncate">{who.name}</b>
            {who.handle && <span className="min-w-0 shrink truncate text-[13px] text-faint">@{who.handle}</span>}
            <span className="shrink-0 text-[13px] text-faint">· 今</span>
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
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
        <span className={`num ${max !== null && length > max ? "font-bold text-danger" : "text-faint"}`}>
          {length.toLocaleString("ja-JP")}
          {max !== null ? ` / ${max.toLocaleString("ja-JP")} 字` : " 字（上限なし）"}
        </span>
        {max !== null && length > max && <span className="font-bold text-danger">{(length - max).toLocaleString("ja-JP")} 字多いので送れません</span>}
      </p>
    </div>
  );
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {/* 保存する前の仮の短縮リンク（送るときに決まる）は薄い字にする */}
      {previewSegments(text).map((s, i) =>
        s.kind === "text" ? <span key={i}>{s.value}</span> : <span key={i} className={s.value.endsWith(`/${PLACEHOLDER_CODE}`) ? "text-faint" : "text-info"}>{s.value}</span>,
      )}
    </>
  );
}

function Images({ images, layout }: { images: AttachedImage[]; layout: "before" | "grid" | "row" }) {
  if (images.length === 0) return null;
  const alt = (image: AttachedImage, i: number) => image.altText || `${i + 1} 枚目の画像`;
  if (layout === "before") {
    // Instagram: 1 枚目を大きく、残りはめくって見る（枚数だけ出す）
    return (
      <div className="relative overflow-hidden rounded-md">
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
  // X・Facebook: 1 枚は元の縦横（縦長は 3:4 まで、横長は 16:9 までで切る）、2 枚は左右に半分ずつ、3 枚は左に 1 枚と右に 2 枚、4 枚は 2×2（previewImageLayout）
  const grid = previewImageLayout(images.slice(0, 4));
  return (
    <div className={`grid gap-0.5 overflow-hidden rounded-xl border border-line ${grid.cols === 2 ? "grid-cols-2" : ""} ${grid.rows === 2 ? "grid-rows-2" : ""}`} style={{ aspectRatio: grid.ratio }}>
      {images.slice(0, 4).map((image, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- 同上
        <img key={image.id} src={image.previewUrl!} alt={alt(image, i)} className={`size-full min-h-0 object-cover ${grid.tall === i ? "row-span-2" : ""}`} />
      ))}
    </div>
  );
}
