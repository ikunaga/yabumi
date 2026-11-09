"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help";
import { Term } from "@/components/ui/term";
import { discardImage } from "@/lib/media/actions";
import { uploadImageFile, uploadJpeg } from "@/lib/media/client-upload";
import { MAX_ALT_LENGTH, MAX_IMAGES_PER_POST, formatBytes } from "@/lib/media/rules";
import { aspectWarnings, carouselMismatches, instagramRatioOk, phoneOrientation, ratioLabel } from "@/lib/media/aspect";
import { renderAspect } from "@/lib/media/aspect-render";
import type { Adjustments } from "@/lib/media/adjust";
import { editSource, editedIds, staleAfterEdit, type EditKind } from "@/lib/media/image-edit";
import { canvasToJpeg } from "@/lib/media/template-render";
import { ImageNumbers, loadBitmap } from "./aspect-options";
import type { BulkAspectOptions } from "./image-aspect-bulk";

import type { ImageMakerProps } from "./image-maker";
import { AiBadge } from "./ai-badge";

// 縦横を整える画面も、開いたときに読み込む
const ImageAspectEditor = dynamic(() => import("./image-aspect-editor").then((m) => m.ImageAspectEditor), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">縦横を整える画面を開いています…</p>,
});

// 調整する画面（明るさ・回転・切り取りなど。4.53）も、開いたときに読み込む
const ImageAdjustEditor = dynamic(() => import("./image-adjust-editor").then((m) => m.ImageAdjustEditor), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">調整する画面を開いています…</p>,
});

const ImageAspectBulk = dynamic(() => import("./image-aspect-bulk").then((m) => m.ImageAspectBulk), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">まとめて整える欄を開いています…</p>,
});

// 画像をつくる画面は、開いたときに読み込む（書体とテンプレートの処理を、作成画面の最初の読み込みに入れない）
const ImageMaker = dynamic(() => import("./image-maker").then((m) => m.ImageMaker), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">画像をつくる画面を開いています…</p>,
});

export type ImageMakerContext = Omit<ImageMakerProps, "onAdd" | "onClose" | "nextIndex" | "first" | "instagram">;

// aiGenerated: AI で作った画像（「AI で作った画像」の札を出す）。
// original: 縦横を整えた・調整したときの元の画像（この画面の中だけで持ち、元に戻すときの元にする。保存はしない）。
// edit: 最後の整え方（縦横を整える・調整する）と、そのとき描き直した元（base。たどり方は src/lib/media/image-edit.ts）。
// 調整したときは、その値（adjust）も持ち、開き直したときにスライダーを戻す
export type AttachedImage = {
  id: string;
  previewUrl: string | null;
  altText: string;
  width: number;
  height: number;
  sizeBytes: number;
  aiGenerated?: boolean;
  original?: AttachedImage;
  edit?: { kind: EditKind; base: AttachedImage; adjust?: Adjustments };
};

// 描き直す元として持つときは、その先の元や整え方を持たない（いまの画像の original と edit で足りる）
function strip(image: AttachedImage): AttachedImage {
  return { ...image, original: undefined, edit: undefined };
}

const sourceOf = (image: AttachedImage) => ({ previewUrl: image.previewUrl!, width: image.width, height: image.height });

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
  // 画像をつくる画面: 開いているか（making）と、一度開いたか（makerMounted）。閉じても外さずに隠すので、
  // 作った候補・絵の説明・フォーマットが残り、続けて 2 枚目をつくれる（オーナーの Notion の項目「1 枚目、2 枚目の作成の手順」）
  const [making, setMaking] = useState(false);
  const [makerMounted, setMakerMounted] = useState(false);
  // 続けて添えるとき（候補をまとめて添えるなど）に、まだ画面に出ていない分も数える
  const countRef = useRef(images.length);
  useEffect(() => {
    countRef.current = images.length;
  }, [images.length]);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // 縦横を整えている画像の ID
  const [adjusting, setAdjusting] = useState<string | null>(null);
  // 調整する画面を開いている画像の ID（縦横を整える画面とは、どちらか 1 つだけ開く）
  const [tuning, setTuning] = useState<string | null>(null);
  // まとめて整える: 欄を開いているか・進み具合・終わったあと（整えた画像の新しい ID と、整えられなかった画像の ID）
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<{ fixedIds: string[]; failedIds: string[] } | null>(null);
  // まとめて整えている間は、並べ替え・外す・1 枚ずつ整えるを止める（番号がずれないように）
  const locked = disabled || bulkProgress !== null;
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

  // つくった画像を添える。添えられたら true（画面は閉じずに、続けて次の画像をつくれる）
  async function addMade(jpeg: Blob, altText: string, ai?: { jobId: string; source: "generated" | "composite" }): Promise<boolean> {
    setError(null);
    if (countRef.current >= MAX_IMAGES_PER_POST) {
      setError(`画像は 1 つの投稿に ${MAX_IMAGES_PER_POST} 枚までです。`);
      return false;
    }
    countRef.current += 1;
    setBusy((n) => n + 1);
    try {
      const image = await uploadJpeg(jpeg, "作った画像", ai);
      onChange((prev) => [...prev, { ...image, altText }]);
      return true;
    } catch (e) {
      countRef.current -= 1;
      setError(e instanceof Error ? e.message : "画像を追加できませんでした。");
      return false;
    } finally {
      setBusy((n) => n - 1);
    }
  }

  function openMaker() {
    setMakerMounted(true);
    setMaking(true);
  }

  // 整えた画像を上げて、いまの画像と差し替える（元の画像は original に持ち、元に戻せる）。差し替えた画像の新しい ID を返す
  async function swap(image: AttachedImage, jpeg: Blob, kind: EditKind, adjust?: Adjustments): Promise<string> {
    const original = image.original ?? image;
    const base = strip(editSource(image, kind));
    const uploaded = await uploadJpeg(jpeg, "整えた画像", original.aiGenerated ? { fromMediaId: original.id } : undefined);
    // 前に整えた画像のうち、元にも、今回描き直した元にもならないものは要らなくなる
    for (const id of staleAfterEdit(image, kind, uploaded.id)) void discardImage(id);
    onChange((prev) => prev.map((p) => (p.id === image.id ? { ...uploaded, altText: p.altText, original, edit: { kind, base, adjust } } : p)));
    return uploaded.id;
  }

  async function replaceWith(image: AttachedImage, jpeg: Blob, kind: EditKind, adjust?: Adjustments): Promise<boolean> {
    setError(null);
    try {
      await swap(image, jpeg, kind, adjust);
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
    for (const id of editedIds(image)) void discardImage(id);
  }

  // 選んだ画像をまとめて同じ枠に整える。1 枚ずつ元の画像から描き直して差し替え、整えられなかった画像は飛ばして続ける（整えた画像はそのまま）
  async function bulkAdjust(options: BulkAspectOptions, targets: number[]) {
    const list = targets.flatMap((i) => (images[i] ? [images[i]] : []));
    if (list.length === 0) return;
    setError(null);
    // 前にまとめて整えた画像も、続けて「まとめて元に戻す」で戻せるようにする（今回また整える画像は、新しい ID に入れ替わる）
    const kept = (bulkResult?.fixedIds ?? []).filter((id) => images.some((im) => im.id === id) && !list.some((im) => im.id === id));
    setBulkResult(null);
    setBulkProgress({ done: 0, total: list.length });
    const fixedIds: string[] = [];
    const failedIds: string[] = [];
    for (const image of list) {
      try {
        const src = editSource(image, "aspect");
        if (!src.previewUrl) throw new Error("no preview");
        const bitmap = await loadBitmap(src.previewUrl);
        const c = document.createElement("canvas");
        try {
          renderAspect(c, bitmap, { ...options, orientation: phoneOrientation(bitmap.width, bitmap.height) });
        } finally {
          bitmap.close();
        }
        fixedIds.push(await swap(image, await canvasToJpeg(c), "aspect"));
      } catch {
        failedIds.push(image.id);
      }
      setBulkProgress({ done: fixedIds.length + failedIds.length, total: list.length });
    }
    setBulkProgress(null);
    setBulkResult({ fixedIds: [...kept, ...fixedIds], failedIds });
    if (failedIds.length === 0) setBulkOpen(false);
  }

  // まとめて整えた画像を、まとめて元に戻す（1 枚ずつの「元に戻す」と同じ。1 枚ずつ整え直した画像は戻さない）
  function revertBulk() {
    if (!bulkResult) return;
    for (const image of images) if (bulkResult.fixedIds.includes(image.id)) revert(image);
    setBulkResult(null);
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
    for (const id of editedIds(image)) void discardImage(id);
  }

  // 縦横の注意（送り先に Instagram があるときだけ）
  const outOfRange = instagram ? images.flatMap((im, i) => (instagramRatioOk(im.width, im.height) ? [] : [i])) : [];
  const mismatches = instagram ? carouselMismatches(images) : [];
  const warnings = instagram ? aspectWarnings(images) : [];
  // 帯は、カルーセルで 1 枚目と違うか、合わない画像が 2 枚以上のとき（1 枚だけなら、その画像の印と「縦横を整える」で足りる）
  const showBand = mismatches.length > 0 || warnings.length >= 2;
  const failedIdx = bulkResult ? images.flatMap((im, i) => (bulkResult.failedIds.includes(im.id) ? [i] : [])) : [];
  const failedCount = failedIdx.length;
  // 整えた画像のうち、まだそのまま並んでいるもの（1 枚ずつ戻したり整え直したりしたものは数えない）
  const fixedCount = bulkResult ? images.filter((im) => bulkResult.fixedIds.includes(im.id)).length : 0;

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
          <Button type="button" variant="secondary" size="sm" disabled={disabled || room <= 0 || making} onClick={openMaker}>
            {images.length > 0 ? `次の画像（${images.length + 1} 枚目）をつくる` : "画像をつくる"}
          </Button>
        )}
        <span className="num text-[13px] text-faint">
          {images.length > 0 && <span className="mr-1 font-bold text-muted">{images.length} 枚</span>}
          <span className="hidden sm:inline">この枠に画像をドラッグしても追加できます・</span>
          {MAX_IMAGES_PER_POST} 枚まで（X は 4 枚）
        </span>
        <HelpTip label="画像の扱い" align="right">
          送る前に JPEG に縮め、撮った場所などの情報は消します。動画は準備中です。
        </HelpTip>
      </div>

      {maker && makerMounted && (
        <div hidden={!making}>
          <ImageMaker
            {...maker}
            nextIndex={images.length + busy + 1}
            first={images[0] ? { width: images[0].width, height: images[0].height } : null}
            instagram={instagram}
            onAdd={addMade}
            onClose={() => setMaking(false)}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      {busy > 0 && <p className="text-sm text-muted">画像を上げています（{busy} 枚）…</p>}

      {showBand && (
        <div className="flex flex-col items-start gap-2 rounded-md bg-surface2 px-3 py-2.5 text-[13px] sm:flex-row sm:items-center sm:gap-3">
          <div className="min-w-0 flex-1 leading-[1.7]">
            {outOfRange.length > 0 && (
              <p>
                <span className="mr-1.5 font-bold text-signal">● Instagram には縦横比が合いません</span>
                <ImageNumbers indexes={outOfRange} />
              </p>
            )}
            {mismatches.length > 0 && (
              <p>
                <span className="mr-1.5 font-bold text-signal">● 要確認</span>
                Instagram では、2 枚目からは 1 枚目の縦横（{ratioLabel(images[0].width, images[0].height)}）に合わせて切られます。
                <ImageNumbers indexes={mismatches} />
                が違います。
              </p>
            )}
          </div>
          {/* まとめて整える欄を開いている間は、欄のボタンだけにする */}
          {bulkOpen ? null : warnings.length >= 2 ? (
            <Button type="button" variant="secondary" size="sm" className="shrink-0" disabled={locked || busy > 0} onClick={() => setBulkOpen(true)}>
              まとめて整える
            </Button>
          ) : (
            // 合わない画像が 1 枚だけ（1 枚目は範囲の中）なら、その場で 1 枚目にそろえる
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0"
              disabled={locked || busy > 0}
              onClick={() => void bulkAdjust({ mode: "crop", ratio: images[0].width / images[0].height, pos: 0.5, fill: { kind: "blur" }, frame: "black" }, mismatches)}
            >
              {bulkProgress ? "そろえています…" : `${mismatches[0] + 1} 枚目を 1 枚目の縦横にそろえる`}
            </Button>
          )}
        </div>
      )}

      {bulkOpen && (
        <ImageAspectBulk
          sizes={images}
          progress={bulkProgress}
          disabled={disabled || busy > 0}
          onRun={(options, targets) => void bulkAdjust(options, targets)}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {bulkResult && (fixedCount > 0 || failedCount > 0) && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {fixedCount > 0 && <span className="num text-muted">{fixedCount} 枚の縦横を整えました。</span>}
          {failedCount > 0 && (
            <span className="num font-semibold text-danger">
              <ImageNumbers indexes={failedIdx} />
              は直せませんでした。もう一度お試しいただくか、1 枚ずつ整えてください。
            </span>
          )}
          {fixedCount > 0 && (
            <button type="button" disabled={locked} onClick={revertBulk} className="text-muted hover:text-fg hover:underline">
              まとめて元に戻す
            </button>
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
                    <button type="button" disabled={locked || i === 0} onClick={() => move(i, -1)} className="font-semibold text-primary hover:underline disabled:text-muted disabled:no-underline" aria-label={`${i + 1} 枚目を前へ`}>
                      ↑ 前へ
                    </button>
                    <button type="button" disabled={locked || i === images.length - 1} onClick={() => move(i, 1)} className="font-semibold text-primary hover:underline disabled:text-muted disabled:no-underline" aria-label={`${i + 1} 枚目を後ろへ`}>
                      ↓ 後ろへ
                    </button>
                    <button type="button" disabled={locked} onClick={() => remove(image)} className="text-muted hover:text-fg hover:underline">
                      外す
                    </button>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {bulkResult?.failedIds.includes(image.id) && <span className="font-bold text-danger">直せませんでした</span>}
                  {instagram && !instagramRatioOk(image.width, image.height) && (
                    <span className="font-bold text-signal">● Instagram には縦横比が合いません（{ratioLabel(image.width, image.height)}）</span>
                  )}
                  {image.original && (
                    <span className="num text-muted">
                      整えました（元 {image.original.width}×{image.original.height}）
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={locked || !editSource(image, "aspect").previewUrl}
                    aria-expanded={adjusting === image.id}
                    onClick={() => {
                      setTuning(null);
                      setAdjusting((a) => (a === image.id ? null : image.id));
                    }}
                    className="font-semibold text-primary hover:underline disabled:text-muted disabled:no-underline"
                  >
                    縦横を整える
                  </button>
                  <button
                    type="button"
                    disabled={locked || !editSource(image, "adjust").previewUrl}
                    aria-expanded={tuning === image.id}
                    onClick={() => {
                      setAdjusting(null);
                      setTuning((a) => (a === image.id ? null : image.id));
                    }}
                    className="font-semibold text-primary hover:underline disabled:text-muted disabled:no-underline"
                  >
                    調整する
                  </button>
                  {image.original && (
                    <button type="button" disabled={locked} onClick={() => revert(image)} className="text-muted hover:text-fg hover:underline">
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
              {adjusting === image.id && editSource(image, "aspect").previewUrl && (
                <div className="col-span-2">
                  <ImageAspectEditor
                    source={sourceOf(editSource(image, "aspect"))}
                    index={i}
                    onApply={(jpeg) => replaceWith(image, jpeg, "aspect")}
                    onClose={() => setAdjusting(null)}
                  />
                </div>
              )}
              {tuning === image.id && editSource(image, "adjust").previewUrl && (
                <div className="col-span-2">
                  <ImageAdjustEditor
                    // 元が変わったら（差し替えたあとに縦横を整えたなど）、前の値を持ち越さずに開き直す
                    key={editSource(image, "adjust").id}
                    source={sourceOf(editSource(image, "adjust"))}
                    initial={image.edit?.kind === "adjust" ? image.edit.adjust : undefined}
                    index={i}
                    onApply={(jpeg, adjust) => replaceWith(image, jpeg, "adjust", adjust)}
                    onClose={() => setTuning(null)}
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
