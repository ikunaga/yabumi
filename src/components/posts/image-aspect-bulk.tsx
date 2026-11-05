"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ASPECT_PRESETS, bulkRatio, bulkTargets, canMatchFirst, defaultBulkAspect, ratioLabel, type BulkAspect } from "@/lib/media/aspect";
import type { AspectMode, AspectRenderOptions, PhoneFrameColor } from "@/lib/media/aspect-render";
import { DEFAULT_CUSTOM_FILL, FillGroup, FrameColorGroup, ImageNumbers, ModeGroup, padFillOf, type FillKey } from "./aspect-options";
import { Choice, Group } from "./maker-parts";

const BULK_HINTS = {
  crop: "はみ出したところを切ります。真ん中を残すので、残す場所はあとで 1 枚ずつ直せます。",
  phone: "アプリの画面などを、スマホの形の枠の画面に入れ、まわりに地を足します。スマホの向きは画像ごとに決めます（縦長の画像は縦、横長の画像は横）。",
};

// まとめて整えるときの決めごと（スマホの向きは画像ごとに決める）
export type BulkAspectOptions = Omit<AspectRenderOptions, "orientation">;

// 縦横の合わない画像を、同じ枠にまとめて整える（選べるものは 1 枚ずつの画面と同じ。切り取る位置は真ん中）
export function ImageAspectBulk({
  sizes,
  progress,
  disabled,
  onRun,
  onClose,
}: {
  sizes: { width: number; height: number }[];
  // 整えている間の進み具合
  progress: { done: number; total: number } | null;
  disabled: boolean;
  onRun: (options: BulkAspectOptions, targets: number[]) => void;
  onClose: () => void;
}) {
  const [aspect, setAspect] = useState<BulkAspect>(() => defaultBulkAspect(sizes));
  const [mode, setMode] = useState<AspectMode>("crop");
  const [fill, setFill] = useState<FillKey>("blur");
  const [custom, setCustom] = useState(DEFAULT_CUSTOM_FILL);
  const [frame, setFrame] = useState<PhoneFrameColor>("black");

  // 1 枚目が範囲の外になったら（並べ替えたときなど）、おすすめの枠に移す
  const choice: BulkAspect = aspect === "first" && !canMatchFirst(sizes) ? "4:5" : aspect;
  const ratio = bulkRatio(choice, sizes)!;
  const targets = bulkTargets(sizes, ratio);
  const running = progress !== null;

  return (
    <section aria-label="縦横をまとめて整える" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 max-sm:p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-bold">縦横をまとめて整える</h3>
        <Button type="button" variant="text" size="sm" className="ml-auto" disabled={running} onClick={onClose}>
          やめる
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        <Group label="枠">
          {canMatchFirst(sizes) && (
            <Choice on={choice === "first"} onClick={() => setAspect("first")}>
              1 枚目に合わせる（{ratioLabel(sizes[0].width, sizes[0].height)}）
            </Choice>
          )}
          {ASPECT_PRESETS.map((p) => (
            <Choice key={p.key} on={choice === p.key} onClick={() => setAspect(p.key)}>
              {p.label}
            </Choice>
          ))}
        </Group>
        <p className="-mt-2 text-xs leading-[1.7] text-muted">
          {targets.length > 0 ? (
            <>
              整える画像: <ImageNumbers indexes={targets} />
              <span className="num">（{targets.length} 枚）</span>。この枠に合っている画像はそのままです。
            </>
          ) : (
            "どの画像もこの枠に合っています。"
          )}
        </p>

        <ModeGroup mode={mode} onChange={setMode} hints={BULK_HINTS} />
        {mode === "phone" && <FrameColorGroup frame={frame} onChange={setFrame} />}
        {mode !== "crop" && <FillGroup fill={fill} custom={custom} onFill={setFill} onCustom={setCustom} />}

        <p className="text-xs leading-[1.7] text-muted">
          整えた画像は、X・Threads など、ほかの送り先にも同じものを送ります。元の画像は残るので、あとで 1 枚ずつ元に戻せます。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button type="button" disabled={disabled || running || targets.length === 0} onClick={() => onRun({ mode, ratio, pos: 0.5, fill: padFillOf(fill, custom), frame }, targets)}>
          {running ? (
            <span className="num">
              整えています（{progress.done} / {progress.total} 枚）…
            </span>
          ) : (
            <span className="num">{targets.length} 枚をまとめて整える</span>
          )}
        </Button>
        <Button type="button" variant="text" disabled={running} onClick={onClose}>
          やめる
        </Button>
      </div>
    </section>
  );
}
