"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help";
import { Term } from "@/components/ui/term";
import { discardImage } from "@/lib/media/actions";
import { uploadImageFile, uploadJpeg } from "@/lib/media/client-upload";
import { MAX_ALT_LENGTH, MAX_IMAGES_PER_POST, formatBytes } from "@/lib/media/rules";
import { carouselMismatches, instagramRatioOk, ratioLabel } from "@/lib/media/aspect";
import { renderCrop } from "@/lib/media/aspect-render";
import { canvasToJpeg } from "@/lib/media/template-render";

import type { ImageMakerProps } from "./image-maker";
import { AiBadge } from "./ai-badge";

// 縦横を整える画面も、開いたときに読み込む
const ImageAspectEditor = dynamic(() => import("./image-aspect-editor").then((m) => m.ImageAspectEditor), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">縦横を整える画面を開いています…</p>,
});

// 画像をつくる画面は、開いたときに読み込む（書体とテンプレートの処理を、作成画面の最初の読み込みに入れない）
const ImageMaker = dynamic(() => import("./image-maker").then((m) => m.ImageMaker), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">画像をつくる画面を開いています…</p>,
});

export type ImageMakerContext = Omit<ImageMakerProps, "onAdd" | "onClose">;

// aiGenerated: AI で作った画像（「AI で作った画像」の札を出す）。
// original: 縦横を整えたときの元の画像（この画面の中だけで持ち、元に戻すときと、整え直すときの元にする。保存はしない）
export type AttachedImage = {
  id: string;
  previewUrl: string | null;
  altText: string;
  width: number;
  height: number;
  sizeBytes: number;
  aiGenerated?: boolean;
  original?: AttachedImage;
};

// 投稿に添える画像。並べ替え・外す・代わりの文（alt）。保存は投稿の保存と一緒に行う（images を savePost に渡す）
export function ImageAttachments({
  images,
  onChange,
  disabled = false,
  maker,
  instagram = false,
}: {
  images: AttachedImage[];
  onChange: (next: AttachedImage[] | ((prev: AttachedImage[]) => AttachedImage[])) => void;
  disabled?: boolean;
  // テンプレートで画像をつくる（F14 の段取り ①）。渡さなければ出さない
  maker?: ImageMakerContext;
  // 送り先に Instagram があるか（縦横比が合わない画像に印を出す）
  instagram?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // 縦横を整えている画像の ID
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [aligning, setAligning] = useState(false);
  const room = MAX_IMAGES_PER_POST - images.length - busy;

  async function addFiles(files: File[]) {
    setError(null);
    const picked = files.slice(0, Math.max(0, room));
    if (files.length > picked.length) setError(`画像は 1 つの投稿に ${MAX_IMAGES_PER_POST} 枚までです。`);
    setBusy((n) => n + picked.length);
    // 順番を保つため、1 枚ずつ上げる
    for (const file of picked) {
      try {
        const image = await uploadImageFile(file);
        onChange((prev) => [...prev, image]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "画像を追加できませんでした。");
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  // テンプレートで作った画像を添える。添えられたら true（画面を閉じる）
  async function addMade(jpeg: Blob, altText: string, ai?: { jobId: string; source: "generated" | "composite" }): Promise<boolean> {
    setError(null);
    if (room <= 0) {
      setError(`画像は 1 つの投稿に ${MAX_IMAGES_PER_POST} 枚までです。`);
      return false;
    }
    setBusy((n) => n + 1);
    try {
      const image = await uploadJpeg(jpeg, "作った画像", ai);
      onChange((prev) => [...prev, { ...image, altText }]);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "画像を追加できませんでした。");
      return false;
    } finally {
      setBusy((n) => n - 1);
    }
  }

  // 整えた画像を上げて、元の画像と差し替える（元の画像は original に持ち、元に戻せる）
  async function replaceWith(image: AttachedImage, jpeg: Blob): Promise<boolean> {
    setError(null);
    const base = image.original ?? image;
    try {
      const uploaded = await uploadJpeg(jpeg, "整えた画像", base.aiGenerated ? { fromMediaId: base.id } : undefined);
      // 前に整えた画像（元ではないもの）は要らなくなる
      if (image.original) void discardImage(image.id);
      onChange((prev) => prev.map((p) => (p.id === image.id ? { ...uploaded, altText: image.altText, original: base } : p)));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "画像を差し替えられませんでした。");
      return false;
    }
  }

  function revert(image: AttachedImage) {
    if (!image.original) return;
    const original = { ...image.original, altText: image.altText };
    onChange((prev) => prev.map((p) => (p.id === image.id ? original : p)));
    void discardImage(image.id);
  }

  // Instagram のカルーセルは 1 枚目の比率で切られるので、2 枚目からを 1 枚目の比率に切ってそろえる（真ん中を残す。あとで 1 枚ずつ直せる）
  async function alignToFirst() {
    const first = images[0];
    if (!first) return;
    const ratio = first.width / first.height;
    setAligning(true);
    setError(null);
    try {
      for (const i of carouselMismatches(images)) {
        const image = images[i];
        const src = image.original ?? image;
        if (!src.previewUrl) continue;
        const res = await fetch(src.previewUrl);
        if (!res.ok) throw new Error(`${i + 1} 枚目を読めませんでした。画面を読み込み直してください。`);
        const bitmap = await createImageBitmap(await res.blob());
        const c = document.createElement("canvas");
        renderCrop(c, bitmap, ratio, 0.5);
        bitmap.close();
        if (!(await replaceWith(image, await canvasToJpeg(c)))) break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "そろえられませんでした。");
    } finally {
      setAligning(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    onChange((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });
  }

  function remove(image: AttachedImage) {
    onChange((prev) => prev.filter((i) => i.id !== image.id));
    if (image.original) void discardImage(image.original.id);
    // まだ投稿に添えていない画像なら、すぐに消える。添えた画像は投稿を保存したときに消える
    void discardImage(image.id);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) void addFiles([...e.dataTransfer.files]);
        }}
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed px-3 py-2.5 text-sm ${dragging ? "border-primary bg-primary-soft" : "border-input text-muted"}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="secondary" size="sm" disabled={disabled || room <= 0} onClick={() => inputRef.current?.click()}>
          画像を選ぶ
        </Button>
        {maker && (
          <Button type="button" variant="secondary" size="sm" disabled={disabled || room <= 0 || making} onClick={() => setMaking(true)}>
            画像をつくる
          </Button>
        )}
        <span className="num text-[13px] text-faint">
          置いても添えられます・{MAX_IMAGES_PER_POST} 枚まで（X は 4 枚）
        </span>
        <HelpTip label="画像の扱い" align="right">
          送る前に JPEG に縮め、撮った場所などの情報は消します。動画は準備中です。
        </HelpTip>
      </div>

      {maker && making && <ImageMaker {...maker} onAdd={addMade} onClose={() => setMaking(false)} />}

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      {busy > 0 && <p className="text-sm text-muted">画像を上げています（{busy} 枚）…</p>}

      {instagram && images.length > 1 && carouselMismatches(images).length > 0 && (
        <div className="flex flex-col items-start gap-2 rounded-md bg-surface2 px-3 py-2.5 text-[13px] sm:flex-row sm:items-center sm:gap-3">
          <p className="min-w-0 flex-1 leading-[1.7]">
            <span className="mr-1.5 font-bold text-signal">● 要確認</span>
            Instagram では、2 枚目からは 1 枚目の縦横（{ratioLabel(images[0].width, images[0].height)}）に合わせて切られます。
            {carouselMismatches(images)
              .map((n) => `${n + 1} 枚目`)
              .join("・")}
            が違います。
          </p>
          {instagramRatioOk(images[0].width, images[0].height) ? (
            <Button type="button" variant="secondary" size="sm" className="shrink-0" disabled={disabled || aligning || busy > 0} onClick={() => void alignToFirst()}>
              {aligning ? "そろえています…" : "全部を 1 枚目の縦横にそろえる"}
            </Button>
          ) : (
            <span className="shrink-0 text-muted">先に 1 枚目の縦横を整えてください</span>
          )}
        </div>
      )}

      {images.length > 0 && (
        <ol className="flex flex-col gap-2.5">
          {images.map((image, i) => (
            <li key={image.id} className="grid grid-cols-[88px_1fr] gap-3 rounded-lg border border-border bg-surface p-2.5 max-sm:grid-cols-[64px_1fr]">
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-surface2">
                {image.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 署名つきの URL は期限があり、next/image の最適化を通さない
                  <img src={image.previewUrl} alt={image.altText || `${i + 1} 枚目の画像`} className="size-full object-cover" />
                ) : (
                  <span className="text-xs text-muted">{i + 1}</span>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="font-bold text-fg">{i + 1} 枚目</span>
                  {image.aiGenerated && <AiBadge />}
                  <span>
                    {image.width}×{image.height}・{formatBytes(image.sizeBytes)}
                  </span>
                  <span className="ml-auto flex gap-3">
                    <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} className="font-semibold text-primary hover:underline disabled:text-muted disabled:no-underline" aria-label={`${i + 1} 枚目を前へ`}>
                      ↑ 前へ
                    </button>
                    <button type="button" disabled={disabled || i === images.length - 1} onClick={() => move(i, 1)} className="font-semibold text-primary hover:underline disabled:text-muted disabled:no-underline" aria-label={`${i + 1} 枚目を後ろへ`}>
                      ↓ 後ろへ
                    </button>
                    <button type="button" disabled={disabled} onClick={() => remove(image)} className="text-muted hover:text-fg hover:underline">
                      外す
                    </button>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {instagram && !instagramRatioOk(image.width, image.height) && (
                    <span className="font-bold text-signal">● Instagram には縦横比が合いません（{ratioLabel(image.width, image.height)}）</span>
                  )}
                  {image.original && (
                    <span className="num text-muted">
                      縦横を整えました（元 {image.original.width}×{image.original.height}）
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={disabled || !(image.original ?? image).previewUrl}
                    aria-expanded={adjusting === image.id}
                    onClick={() => setAdjusting((a) => (a === image.id ? null : image.id))}
                    className="font-semibold text-primary hover:underline disabled:text-muted disabled:no-underline"
                  >
                    縦横を整える
                  </button>
                  {image.original && (
                    <button type="button" disabled={disabled} onClick={() => revert(image)} className="text-muted hover:text-fg hover:underline">
                      元に戻す
                    </button>
                  )}
                </div>
                <label htmlFor={`alt-${image.id}`} className="text-xs font-bold">
                  画像の説明文<span className="ml-1 font-normal text-muted">何が写っているか（任意）</span>
                </label>
                <textarea
                  id={`alt-${image.id}`}
                  rows={2}
                  maxLength={MAX_ALT_LENGTH}
                  disabled={disabled}
                  value={image.altText}
                  onChange={(e) => {
                    const altText = e.target.value;
                    onChange((prev) => prev.map((p) => (p.id === image.id ? { ...p, altText } : p)));
                  }}
                  placeholder="例: 焼きたてのクロワッサンが 6 個並んだトレー。店の入口の木の棚の上"
                  className="w-full rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
                />
              </div>
              {adjusting === image.id && (image.original ?? image).previewUrl && (
                <div className="col-span-2">
                  <ImageAspectEditor
                    source={{ previewUrl: (image.original ?? image).previewUrl!, width: (image.original ?? image).width, height: (image.original ?? image).height }}
                    index={i}
                    onApply={(jpeg) => replaceWith(image, jpeg)}
                    onClose={() => setAdjusting(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {images.length > 0 && (
        <p className="text-xs leading-[1.7] text-muted">
          画像の説明文は、目の見えにくい人のスマホが読み上げたり、画像が表示されないときに代わりに出たりする文です（alt）。投稿の本文には出ません。X では 1 枚につき $0.005（1 円ほど）の<Term k="payPerUse">API の料金</Term>がかかります。
        </p>
      )}
    </div>
  );
}
