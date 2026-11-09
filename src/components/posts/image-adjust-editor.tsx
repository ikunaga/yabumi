"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { autoTone, isNeutral, MAX_STRAIGHTEN, NEUTRAL, NEUTRAL_TONE, rotateLeft, rotateRight, rotatedSize, sameAdjustments, type Adjustments, type CropKey, type ToneKey } from "@/lib/media/adjust";
import { readPixels, renderAdjust } from "@/lib/media/adjust-render";
import { ASPECT_PRESETS, cropAxis, dragToPos, presetRatio } from "@/lib/media/aspect";
import { canvasToJpeg } from "@/lib/media/template-render";
import { loadBitmap } from "./aspect-options";
import { Choice, Group } from "./maker-parts";

const TONE_SLIDERS: { key: ToneKey; label: string; low: string; high: string }[] = [
  { key: "brightness", label: "明るさ", low: "暗く", high: "明るく" },
  { key: "contrast", label: "コントラスト", low: "やわらかく", high: "くっきり" },
  { key: "saturation", label: "あざやかさ", low: "おだやかに", high: "あざやかに" },
  { key: "warmth", label: "色あい", low: "冷たく（青み）", high: "暖かく（赤み）" },
];

// 添えた画像を調整する（明るさ・コントラスト・あざやかさ・色あい、回転・まっすぐにする、切り取り。4.53）。
// ブラウザーの中だけで描き直し、できた JPEG を 4.18 の流れで上げて差し替える（縦横を整えると同じ。元の画像は残り、元に戻せる）
export function ImageAdjustEditor({
  source,
  initial,
  index,
  onApply,
  onClose,
}: {
  // 調整の元（前に調整していれば、その前の画像。描き直しを重ねて画質を落とさないため。縦横を整えたあとなら、整えた画像）
  source: { previewUrl: string; width: number; height: number };
  // 前に調整したときの値（開き直したときに、スライダーをそこから始める）
  initial?: Adjustments;
  index: number;
  onApply: (jpeg: Blob, adjustments: Adjustments) => Promise<boolean>;
  onClose: () => void;
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [adj, setAdj] = useState<Adjustments>(initial ?? NEUTRAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; pos: number } | null>(null);
  const frameReq = useRef(0);

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

  // 見本は小さく描く（スライダーを動かしている間は、1 コマに 1 回だけ）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    cancelAnimationFrame(frameReq.current);
    frameReq.current = requestAnimationFrame(() => renderAdjust(canvas, bitmap, adj, 720));
    return () => cancelAnimationFrame(frameReq.current);
  }, [bitmap, adj]);

  const frame = rotatedSize(source.width, source.height, adj.rotation);
  const ratio = adj.crop === "original" ? null : presetRatio(adj.crop);
  const axis = ratio ? cropAxis(frame.w, frame.h, ratio) : null;
  const set = (patch: Partial<Adjustments>) => setAdj((a) => ({ ...a, ...patch }));
  const setTone = (key: ToneKey, v: number) => setAdj((a) => ({ ...a, tone: { ...a.tone, [key]: v } }));

  // おまかせ: 色を変える前の見本を小さく描いて、明るさの分布から決める（あざやかさ・色あいはそのまま）
  function auto() {
    if (!bitmap) return;
    const c = document.createElement("canvas");
    renderAdjust(c, bitmap, { ...adj, tone: NEUTRAL_TONE }, 360);
    const px = readPixels(c);
    if (!px) return;
    const t = autoTone(px);
    setAdj((a) => ({ ...a, tone: { ...a.tone, brightness: t.brightness, contrast: t.contrast } }));
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!axis) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pos: adj.pos };
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d || !axis || !ratio) return;
    const shown = axis === "x" ? e.currentTarget.clientWidth : e.currentTarget.clientHeight;
    const delta = axis === "x" ? e.clientX - d.x : e.clientY - d.y;
    set({ pos: dragToPos(d.pos, delta, frame.w, frame.h, ratio, shown) });
  }

  async function apply() {
    if (!bitmap) return;
    setBusy(true);
    setError(null);
    try {
      const c = document.createElement("canvas");
      renderAdjust(c, bitmap, adj);
      if (await onApply(await canvasToJpeg(c), adj)) onClose();
    } catch {
      setError("画像を調整できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  const tall = (ratio ?? frame.w / frame.h) < 1;
  // おまかせ・最初に戻す（PC は見本の下、スマホはスライダーの上。スマホで上に留める見本を小さく保つため）
  const quick = (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" size="sm" disabled={!bitmap} onClick={auto} className="max-sm:h-10">
        おまかせで整える
      </Button>
      <Button type="button" variant="secondary" size="sm" disabled={isNeutral(adj)} onClick={() => setAdj(NEUTRAL)} className="max-sm:h-10">
        調整を最初に戻す
      </Button>
    </div>
  );
  return (
    <section aria-label={`${index + 1} 枚目を調整する`} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 max-sm:p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-bold">{index + 1} 枚目を調整する</h3>
        <Button type="button" variant="text" size="sm" className="ml-auto" onClick={onClose}>
          やめる
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* スマホでは見本を上に留め、下のスライダーを動かしながら見られるようにする */}
        <div className="flex min-w-0 flex-col gap-2 bg-surface max-lg:sticky max-lg:top-0 max-lg:z-10 max-lg:pb-2 lg:order-2">
          <div className="flex items-center justify-center rounded-md border border-line bg-surface2 p-2">
            {loadError ? (
              <p className="py-10 text-sm text-danger">画像を読めませんでした。画面を読み込み直してください。</p>
            ) : bitmap ? (
              <canvas
                ref={canvasRef}
                role="img"
                aria-label="調整したあとの見本"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
                className={`block h-auto w-full select-none max-lg:max-h-[30vh] max-lg:w-auto max-lg:max-w-full ${tall ? "lg:max-w-[320px]" : ""} ${axis ? `touch-none ${axis === "x" ? "cursor-ew-resize" : "cursor-ns-resize"}` : ""}`}
              />
            ) : (
              <p className="py-10 text-sm text-muted">画像を読み込んでいます…</p>
            )}
          </div>
          {axis && bitmap && <p className="text-xs text-muted">見本を{axis === "x" ? "左右" : "上下"}に動かして、残す場所を決められます</p>}
          <div className="max-lg:hidden">{quick}</div>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:order-1">
          <div className="lg:hidden">{quick}</div>
          {TONE_SLIDERS.map((s) => (
            <Slider key={s.key} label={s.label} low={s.low} high={s.high} value={adj.tone[s.key]} min={-100} max={100} step={1} onChange={(v) => setTone(s.key, v)} />
          ))}

          <Group label="向き">
            <Choice on={false} onClick={() => set({ rotation: rotateLeft(adj.rotation), pos: 0.5 })} className="max-sm:py-2.5">
              ↺ 左に 90° 回す
            </Choice>
            <Choice on={false} onClick={() => set({ rotation: rotateRight(adj.rotation), pos: 0.5 })} className="max-sm:py-2.5">
              ↻ 右に 90° 回す
            </Choice>
          </Group>
          <Slider
            label="まっすぐにする"
            low={`左に ${MAX_STRAIGHTEN}°`}
            high={`右に ${MAX_STRAIGHTEN}°`}
            value={adj.straighten}
            min={-MAX_STRAIGHTEN}
            max={MAX_STRAIGHTEN}
            step={0.5}
            unit="°"
            onChange={(v) => set({ straighten: v })}
          />

          <Group label="切り取り">
            {(["original", ...ASPECT_PRESETS.map((p) => p.key)] as CropKey[]).map((k) => (
              <Choice key={k} on={adj.crop === k} onClick={() => set({ crop: k, pos: 0.5 })} className="max-sm:py-2.5">
                {k === "original" ? "切り取らない" : ASPECT_PRESETS.find((p) => p.key === k)!.label}
              </Choice>
            ))}
          </Group>

          <p className="text-xs leading-[1.7] text-muted">
            調整した画像は、X・Threads など、ほかの送り先にも同じものを送ります。元の画像は残るので、あとで元に戻せます。
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button type="button" disabled={!bitmap || busy || sameAdjustments(adj, initial ?? NEUTRAL)} onClick={() => void apply()}>
          {busy ? "差し替えています…" : "この調整で差し替える"}
        </Button>
        <Button type="button" variant="text" onClick={onClose}>
          やめる
        </Button>
      </div>
    </section>
  );
}

// スマホの指でも動かしやすいよう、つまみと当たり判定を大きくしたスライダー
function Slider({ label, low, high, value, min, max, step, unit = "", onChange }: { label: string; low: string; high: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-bold" aria-hidden>
          {label}
        </span>
        <button type="button" onClick={() => onChange(0)} disabled={value === 0} className="num text-xs text-muted hover:text-fg disabled:hover:text-muted" aria-label={`${label}を 0 に戻す`}>
          {value > 0 ? "+" : ""}
          {value}
          {unit}
        </button>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={`${value > 0 ? "+" : ""}${value}${unit}`}
        className="h-8 w-full cursor-pointer accent-[var(--primary)] max-sm:h-10"
      />
      <span className="flex justify-between text-xs text-muted">
        <span>{low}</span>
        <span>{high}</span>
      </span>
    </div>
  );
}
