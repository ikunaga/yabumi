import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { glossary, illustrationAlt, illustrationSrc, type GlossaryKey } from "@/lib/glossary/terms";

// 用語の挿絵（public/glossary/<key>.webp。4.45）。角を丸めた生成りの枠に置き、ダークでも浮かないようにする。
// ファイルがまだない語は、同じ枠に語の頭文字を出す（作り直しの途中でも崩れないように）
export function Illustration({ k, size, priority = false }: { k: GlossaryKey; size: "thumb" | "large" | "small"; priority?: boolean }) {
  const term = glossary[k];
  const has = existsSync(path.join(process.cwd(), "public", illustrationSrc(k)));
  const frame = {
    thumb: "aspect-[3/2] w-full rounded-md",
    large: "aspect-[3/2] w-full rounded-lg",
    small: "aspect-square w-16 shrink-0 rounded-md",
  }[size];
  return (
    <div className={`${frame} overflow-hidden border border-line bg-illust`}>
      {has ? (
        // 挿絵は手で縮めた webp なので、next/image は使わない（そのまま出す）
        // eslint-disable-next-line @next/next/no-img-element
        <img src={illustrationSrc(k)} alt={illustrationAlt(term)} loading={priority ? "eager" : "lazy"} decoding="async" className="size-full object-cover dark:brightness-[0.85]" />
      ) : (
        <span aria-hidden className="grid size-full place-items-center text-2xl font-bold text-primary/40">
          {term.label.slice(0, 1)}
        </span>
      )}
    </div>
  );
}
