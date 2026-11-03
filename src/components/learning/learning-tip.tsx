"use client";

import Link from "next/link";
import { glossaryHref, type GlossaryKey } from "@/lib/glossary/terms";
import { useEffect, useRef, useState } from "react";
import { claimTip, type ShownTip } from "@/lib/learning/actions";
import type { TipTrigger } from "@/lib/learning/tips";

// 作業のあとの「ひとこと」（4.47）。窓で割り込まず、その画面の中に小さく 1 行で出す。
// when が true になった最初の 1 回だけサーバーに聞き（1 日 1 回まで・オフなら出ない）、出たものは「×」で消せる（閉じなくても邪魔にならない）
export function LearningTip({ trigger, when = true, className = "" }: { trigger: TipTrigger; when?: boolean; className?: string }) {
  const [tip, setTip] = useState<ShownTip | null>(null);
  const [hidden, setHidden] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    if (!when || asked.current) return;
    asked.current = true;
    // 1 回聞いたら、返事は必ず受け取る（取り消すと、その日の 1 回を使ったのに出ないことがある）
    claimTip(trigger)
      .then(setTip)
      .catch(() => {
        // 出せなくても作業には関係ない
      });
  }, [when, trigger]);

  if (!tip || hidden) return null;
  return (
    <p role="status" className={`flex items-start gap-2 rounded-md bg-surface2 px-3 py-2 text-[13px] leading-[1.7] ${className}`}>
      <span className="min-w-0 flex-1">
        <b>ひとこと：</b>
        {tip.text}
        <Link href={glossaryHref(tip.term.key as GlossaryKey)} className="ml-1 font-semibold whitespace-nowrap text-primary hover:underline">
          {tip.term.label}をくわしく →
        </Link>
      </span>
      <button type="button" aria-label="ひとことを閉じる" onClick={() => setHidden(true)} className="shrink-0 rounded px-1 text-base leading-none text-muted hover:text-fg">
        ×
      </button>
    </p>
  );
}
