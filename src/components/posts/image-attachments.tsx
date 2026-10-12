"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Term } from "@/components/ui/term";
import { confirmImageUpload, discardImage, requestImageUpload } from "@/lib/media/actions";
import { JPEG_QUALITY, MAX_ALT_LENGTH, MAX_IMAGE_BYTES, MAX_IMAGES_PER_POST, MAX_LONG_EDGE, formatBytes } from "@/lib/media/rules";

import type { ImageMakerProps } from "./image-maker";

// 画像をつくる画面は、開いたときに読み込む（書体とテンプレートの処理を、作成画面の最初の読み込みに入れない）
const ImageMaker = dynamic(() => import("./image-maker").then((m) => m.ImageMaker), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">画像をつくる画面を開いています…</p>,
});

export type ImageMakerContext = Omit<ImageMakerProps, "onAdd" | "onClose">;

export type AttachedImage = { id: string; previewUrl: string | null; altText: string; width: number; height: number; sizeBytes: number };

// 画像を JPEG に描き直し、長い辺を MAX_LONG_EDGE までに縮める。描き直すので、位置情報などのメタデータは残らない。
// 画像として読めないファイル（拡張子だけ画像のものなど）は、ここで読めずに失敗する
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  // JPEG は透明を持てないので、透明なところは白で埋める（画像の中身の色。画面の色ではない）
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [JPEG_QUALITY, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_IMAGE_BYTES) return blob;
  }
  throw new Error("too_large");
}

async function uploadOne(file: File): Promise<AttachedImage> {
  let blob: Blob;
  try {
    blob = await toJpeg(file);
  } catch (e) {
    throw new Error(
      e instanceof Error && e.message === "too_large"
        ? `「${file.name}」は縮めても ${formatBytes(MAX_IMAGE_BYTES)} を超えます。`
        : `「${file.name}」は画像として読めませんでした。JPEG・PNG・WebP などの画像を選んでください。`,
    );
  }
  return uploadJpeg(blob, `「${file.name}」`);
}

// JPEG を上げて確かめる（選んだ画像も、テンプレートで作った画像も同じ流れ。4.18）
async function uploadJpeg(blob: Blob, name: string): Promise<AttachedImage> {
  if (blob.size > MAX_IMAGE_BYTES) throw new Error(`${name}は ${formatBytes(MAX_IMAGE_BYTES)} を超えます。`);
  const { ticket, error } = await requestImageUpload();
  if (!ticket) throw new Error(error ?? "画像を追加できませんでした。");
  const res = await fetch(ticket.signedUrl, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg", "x-upsert": "false" } });
  if (!res.ok) throw new Error(`${name}を上げられませんでした。時間をおいてもう一度お試しください。`);
  const confirmed = await confirmImageUpload(ticket.path);
  if (!confirmed.image) throw new Error(confirmed.error ?? "画像を確かめられませんでした。");
  const { id, previewUrl, altText, width, height, sizeBytes } = confirmed.image;
  return { id, previewUrl, altText, width, height, sizeBytes };
}

// 投稿に添える画像。並べ替え・外す・代わりの文（alt）。保存は投稿の保存と一緒に行う（images を savePost に渡す）
export function ImageAttachments({
  images,
  onChange,
  disabled = false,
  maker,
}: {
  images: AttachedImage[];
  onChange: (next: AttachedImage[] | ((prev: AttachedImage[]) => AttachedImage[])) => void;
  disabled?: boolean;
  // テンプレートで画像をつくる（F14 の段取り ①）。渡さなければ出さない
  maker?: ImageMakerContext;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const room = MAX_IMAGES_PER_POST - images.length - busy;

  async function addFiles(files: File[]) {
    setError(null);
    const picked = files.slice(0, Math.max(0, room));
    if (files.length > picked.length) setError(`画像は 1 つの投稿に ${MAX_IMAGES_PER_POST} 枚までです。`);
    setBusy((n) => n + picked.length);
    // 順番を保つため、1 枚ずつ上げる
    for (const file of picked) {
      try {
        const image = await uploadOne(file);
        onChange((prev) => [...prev, image]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "画像を追加できませんでした。");
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  // テンプレートで作った画像を添える。添えられたら true（画面を閉じる）
  async function addMade(jpeg: Blob, altText: string): Promise<boolean> {
    setError(null);
    if (room <= 0) {
      setError(`画像は 1 つの投稿に ${MAX_IMAGES_PER_POST} 枚までです。`);
      return false;
    }
    setBusy((n) => n + 1);
    try {
      const image = await uploadJpeg(jpeg, "作った画像");
      onChange((prev) => [...prev, { ...image, altText }]);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "画像を追加できませんでした。");
      return false;
    } finally {
      setBusy((n) => n - 1);
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
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed px-4 py-6 text-center text-sm ${dragging ? "border-primary bg-primary-soft" : "border-border text-muted"}`}
        style={dragging ? undefined : { background: "repeating-linear-gradient(45deg, transparent 0 10px, var(--rule) 10px 11px)" }}
      >
        <p>画像をここに置くか、選んでください（{MAX_IMAGES_PER_POST} 枚まで。X は 4 枚まで）</p>
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
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={disabled || room <= 0} onClick={() => inputRef.current?.click()}>
            画像を選ぶ
          </Button>
          {maker && (
            <Button type="button" variant="secondary" size="sm" disabled={disabled || room <= 0 || making} onClick={() => setMaking(true)}>
              画像をつくる
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">送る前に JPEG に縮め、撮った場所などの情報は消します。動画は準備中です。</p>
      </div>

      {maker && making && <ImageMaker {...maker} onAdd={addMade} onClose={() => setMaking(false)} />}

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      {busy > 0 && <p className="text-sm text-muted">画像を上げています（{busy} 枚）…</p>}

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
                <label htmlFor={`alt-${image.id}`} className="text-xs font-bold">
                  代わりの文（alt）
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
                  placeholder="例: 家計簿アプリの月ごとのグラフの画面。食費が先月より 2 割減っている"
                  className="w-full rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
                />
              </div>
            </li>
          ))}
        </ol>
      )}
      {images.length > 0 && (
        <p className="text-xs leading-[1.7] text-muted">
          代わりの文は、目の見えにくい人の読み上げや、画像が表示されないときに出る説明です。何が写っているかを一文で書きます。X では 1 枚につき $0.005（1 円ほど）の<Term k="payPerUse">API の料金</Term>がかかります。
        </p>
      )}
    </div>
  );
}
