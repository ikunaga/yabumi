"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ASPECT_PRESETS,
  cropAxis,
  dragToPos,
  instagramRatioOk,
  phoneCropSide,
  phoneOrientation,
  presetRatio,
  ratioLabel,
  suggestAspect,
  type AspectKey,
  type PhoneOrientation,
} from "@/lib/media/aspect";
import { renderCrop, renderPad, renderPhoneFrame, type PadFill, type PhoneFrameColor } from "@/lib/media/aspect-render";
import { canvasToJpeg } from "@/lib/media/template-render";
import { Choice, Group } from "./maker-parts";

type Mode = "crop" | "pad" | "phone";
const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "crop", label: "切り取る", hint: "はみ出したところを切ります。" },
  { key: "pad", label: "余白を足す", hint: "切らずに、まわりに地を足して収めます。" },
  { key: "phone", label: "スマホの枠に入れる", hint: "アプリの画面などを、スマホの形の枠の画面に入れ、まわりに地を足します。" },
];
// 画面に収まらない分を切る向き
const PHONE_CROP_NOTE = {
  bottom: "画面より縦に長いので、上をそろえて下を切ります。",
  sides: "画面より横に広いので、左右を切ります。",
  topBottom: "画面より縦に長いので、上下を切ります。",
} as const;
// 足す地（画像の中身の色。画面の色ではない）
const FILLS = [
  { key: "blur", label: "ぼかした同じ画像" },
  { key: "white", label: "白" },
  { key: "black", label: "黒" },
] as const;
type FillKey = (typeof FILLS)[number]["key"] | "custom";

// 署名つきの URL から読む（fetch で読むので、Canvas に描いても書き出せる）
async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("load");
  return createImageBitmap(await res.blob());
}

// 添えた画像の縦横を整える（Instagram の 4:5〜1.91:1 に収める）。ブラウザの中だけで描き直し、できた JPEG を 4.18 の流れで上げて差し替える
export function ImageAspectEditor({
  source,
  index,
  initialAspect,
  onApply,
  onClose,
}: {
  // 整える元（前に整えていれば、その前の元の画像。描き直しを重ねて画質を落とさないため）
  source: { previewUrl: string; width: number; height: number };
  index: number;
  initialAspect?: AspectKey;
  onApply: (jpeg: Blob) => Promise<boolean>;
  onClose: () => void;
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [mode, setMode] = useState<Mode>("crop");
  const [aspect, setAspect] = useState<AspectKey>(initialAspect ?? suggestAspect(source.width, source.height));
  const [pos, setPos] = useState(0.5);
  const [fill, setFill] = useState<FillKey>("blur");
  const [custom, setCustom] = useState("#f6f1e7");
  const [orientation, setOrientation] = useState<PhoneOrientation>(phoneOrientation(source.width, source.height));
  const [frame, setFrame] = useState<PhoneFrameColor>("black");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; pos: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let loaded: ImageBitmap | null = null;
    loadBitmap(source.previewUrl)
      .then((b) => {
        loaded = b;
        if (alive) setBitmap(b);
        else b.close();
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
      loaded?.close();
    };
  }, [source.previewUrl]);

  const ratio = presetRatio(aspect);
  const padFill: PadFill = fill === "blur" ? { kind: "blur" } : { kind: "color", color: fill === "custom" ? custom : fill === "white" ? "#ffffff" : "#000000" };
  const axis = cropAxis(source.width, source.height, ratio);

  // 見本は小さく描く（できあがりと同じ計算で、幅だけ縮める）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    draw(canvas, 720);
    // draw は下の state から描く
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bitmap, mode, ratio, pos, fill, custom, orientation, frame]);

  function draw(canvas: HTMLCanvasElement, maxW?: number) {
    if (!bitmap) return;
    if (mode === "crop") renderCrop(canvas, bitmap, ratio, pos, maxW);
    else if (mode === "pad") renderPad(canvas, bitmap, ratio, padFill, maxW);
    else renderPhoneFrame(canvas, bitmap, ratio, { orientation, frame, fill: padFill }, maxW);
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== "crop" || !axis) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pos };
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d || !axis) return;
    const shown = axis === "x" ? e.currentTarget.clientWidth : e.currentTarget.clientHeight;
    const delta = axis === "x" ? e.clientX - d.x : e.clientY - d.y;
    setPos(dragToPos(d.pos, delta, source.width, source.height, ratio, shown));
  }

  async function apply() {
    if (!bitmap) return;
    setBusy(true);
    setError(null);
    try {
      const c = document.createElement("canvas");
      draw(c);
      if (await onApply(await canvasToJpeg(c))) onClose();
    } catch {
      setError("画像を整えられませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  const tall = ratio < 1;
  const phoneCrop = phoneCropSide(source.width, source.height, orientation);
  return (
    <section aria-label={`${index + 1} 枚目の縦横を整える`} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 max-sm:p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-bold">{index + 1} 枚目の縦横を整える</h3>
        <span className="num text-xs text-muted">
          いま {ratioLabel(source.width, source.height)}（{source.width}×{source.height}）
        </span>
        <Button type="button" variant="text" size="sm" className="ml-auto" onClick={onClose}>
          やめる
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2 lg:order-2">
          <div className="flex items-center justify-center rounded-md border border-line bg-surface2 p-2">
            {loadError ? (
              <p className="py-10 text-sm text-danger">画像を読めませんでした。画面を読み込み直してください。</p>
            ) : bitmap ? (
              <canvas
                ref={canvasRef}
                role="img"
                aria-label="整えたあとの見本"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
                className={`block h-auto w-full touch-none select-none ${tall ? "max-w-[320px]" : ""} ${mode === "crop" && axis ? (axis === "x" ? "cursor-ew-resize" : "cursor-ns-resize") : ""}`}
              />
            ) : (
              <p className="py-10 text-sm text-muted">画像を読み込んでいます…</p>
            )}
          </div>
          {mode === "crop" && axis && bitmap && <p className="text-xs text-muted">見本を{axis === "x" ? "左右" : "上下"}にドラッグして、残す場所を決められます（スマホは指で）</p>}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:order-1">
          <Group label="整え方">
            {MODES.map((m) => (
              <Choice key={m.key} on={mode === m.key} onClick={() => setMode(m.key)}>
                {m.label}
              </Choice>
            ))}
          </Group>
          <p className="-mt-2 text-xs leading-[1.7] text-muted">{MODES.find((m) => m.key === mode)!.hint}</p>

          <Group label="枠">
            {ASPECT_PRESETS.map((p) => (
              <Choice
                key={p.key}
                on={aspect === p.key}
                onClick={() => {
                  setAspect(p.key);
                  setPos(0.5);
                }}
              >
                {p.label}
              </Choice>
            ))}
          </Group>

          {mode === "crop" && axis && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] font-bold">残す場所</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(pos * 100)}
                onChange={(e) => setPos(Number(e.target.value) / 100)}
                aria-valuetext={axis === "x" ? (pos < 0.34 ? "左寄り" : pos > 0.66 ? "右寄り" : "真ん中") : pos < 0.34 ? "上寄り" : pos > 0.66 ? "下寄り" : "真ん中"}
                className="w-full accent-[var(--primary)]"
              />
              <span className="flex justify-between text-xs text-muted">
                <span>{axis === "x" ? "左" : "上"}</span>
                <span>{axis === "x" ? "右" : "下"}</span>
              </span>
            </label>
          )}

          {mode === "phone" && (
            <>
              <Group label="スマホの向き">
                <Choice on={orientation === "portrait"} onClick={() => setOrientation("portrait")}>
                  縦
                </Choice>
                <Choice on={orientation === "landscape"} onClick={() => setOrientation("landscape")}>
                  横
                </Choice>
              </Group>
              {phoneCrop && <p className="-mt-2 text-xs leading-[1.7] text-muted">{PHONE_CROP_NOTE[phoneCrop]}</p>}
              <Group label="枠の色">
                <Choice on={frame === "black"} onClick={() => setFrame("black")}>
                  黒
                </Choice>
                <Choice on={frame === "white"} onClick={() => setFrame("white")}>
                  白
                </Choice>
              </Group>
            </>
          )}

          {mode !== "crop" && (
            <Group label="足す地">
              {FILLS.map((f) => (
                <Choice key={f.key} on={fill === f.key} onClick={() => setFill(f.key)}>
                  {f.label}
                </Choice>
              ))}
              <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${fill === "custom" ? "border-primary bg-primary-soft font-bold text-primary" : "border-border"}`}>
                <input
                  type="color"
                  aria-label="地の色を選ぶ"
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setFill("custom");
                  }}
                  className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <button type="button" aria-pressed={fill === "custom"} onClick={() => setFill("custom")}>
                  色を選ぶ
                </button>
              </span>
            </Group>
          )}

          <p className="text-xs leading-[1.7] text-muted">
            整えた画像は、X・Threads など、ほかの送り先にも同じものを送ります。元の画像は残るので、あとで元に戻せます。
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button type="button" disabled={!bitmap || busy} onClick={() => void apply()}>
          {busy ? "差し替えています…" : "この縦横で差し替える"}
        </Button>
        <Button type="button" variant="text" onClick={onClose}>
          やめる
        </Button>
        {!instagramRatioOk(source.width, source.height) && <span className="text-sm text-muted">どの枠も Instagram に送れます</span>}
      </div>
    </section>
  );
}
