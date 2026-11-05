"use client";

import type { AspectMode, PadFill } from "@/lib/media/aspect-render";
import { Choice, Group } from "./maker-parts";

// 縦横を整えるときの選択肢（1 枚ずつの画面と、まとめて整える欄で同じものを出す）

export const MODES: { key: AspectMode; label: string; hint: string }[] = [
  { key: "crop", label: "切り取る", hint: "はみ出したところを切ります。" },
  { key: "pad", label: "余白を足す", hint: "切らずに、まわりに地を足して収めます。" },
  { key: "phone", label: "スマホの枠に入れる", hint: "アプリの画面などを、スマホの形の枠の画面に入れ、まわりに地を足します。" },
];

// 足す地（画像の中身の色。画面の色ではない）
export const FILLS = [
  { key: "blur", label: "ぼかした同じ画像" },
  { key: "white", label: "白" },
  { key: "black", label: "黒" },
] as const;
export type FillKey = (typeof FILLS)[number]["key"] | "custom";
export const DEFAULT_CUSTOM_FILL = "#f6f1e7";

export function padFillOf(fill: FillKey, custom: string): PadFill {
  return fill === "blur" ? { kind: "blur" } : { kind: "color", color: fill === "custom" ? custom : fill === "white" ? "#ffffff" : "#000000" };
}

// 署名つきの URL から読む（fetch で読むので、Canvas に描いても書き出せる）
export async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("load");
  return createImageBitmap(await res.blob());
}

// hints: 整え方ごとの説明を差し替える（まとめて整えるときは、切る位置などを書き足す）
export function ModeGroup({ mode, onChange, hints }: { mode: AspectMode; onChange: (m: AspectMode) => void; hints?: Partial<Record<AspectMode, string>> }) {
  return (
    <>
      <Group label="整え方">
        {MODES.map((m) => (
          <Choice key={m.key} on={mode === m.key} onClick={() => onChange(m.key)}>
            {m.label}
          </Choice>
        ))}
      </Group>
      <p className="-mt-2 text-xs leading-[1.7] text-muted">{hints?.[mode] ?? MODES.find((m) => m.key === mode)!.hint}</p>
    </>
  );
}

export function FrameColorGroup({ frame, onChange }: { frame: "black" | "white"; onChange: (f: "black" | "white") => void }) {
  return (
    <Group label="枠の色">
      <Choice on={frame === "black"} onClick={() => onChange("black")}>
        黒
      </Choice>
      <Choice on={frame === "white"} onClick={() => onChange("white")}>
        白
      </Choice>
    </Group>
  );
}

export function FillGroup({ fill, custom, onFill, onCustom }: { fill: FillKey; custom: string; onFill: (f: FillKey) => void; onCustom: (c: string) => void }) {
  return (
    <Group label="足す地">
      {FILLS.map((f) => (
        <Choice key={f.key} on={fill === f.key} onClick={() => onFill(f.key)}>
          {f.label}
        </Choice>
      ))}
      <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${fill === "custom" ? "border-primary bg-primary-soft font-bold text-primary" : "border-border"}`}>
        <input
          type="color"
          aria-label="地の色を選ぶ"
          value={custom}
          onChange={(e) => {
            onCustom(e.target.value);
            onFill("custom");
          }}
          className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <button type="button" aria-pressed={fill === "custom"} onClick={() => onFill("custom")}>
          色を選ぶ
        </button>
      </span>
    </Group>
  );
}

// 「2 枚目・3 枚目」。狭い画面でも「2 枚目」の途中で折り返さない
export function ImageNumbers({ indexes }: { indexes: number[] }) {
  return indexes.map((n, k) => (
    <span key={n} className="whitespace-nowrap">
      {k > 0 && "・"}
      {n + 1} 枚目
    </span>
  ));
}
