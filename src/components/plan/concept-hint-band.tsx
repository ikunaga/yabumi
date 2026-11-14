"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BandCloseButton } from "@/components/ui/band-close";
import { closeConceptHint } from "@/lib/plan/actions";

// 概要の「コンセプトを決める」（4.50）。最初の 4 段階が済んで、コンセプトがまだの人にだけ出す小さな 1 行。「×」でこの端末では出さない
export function ConceptHintBand({ projectId }: { projectId: string }) {
  const [hidden, setHidden] = useState(false);
  const [, startTransition] = useTransition();
  if (hidden) return null;
  const href = `/projects/${projectId}/plan?open=concept#plan-concept-head`;
  return (
    <aside aria-label="コンセプトを決める" className="flex items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface px-4 py-2 text-sm max-sm:flex-wrap max-sm:px-3">
      <span className="shrink-0 rounded-sm bg-info-soft px-1.5 py-0.5 text-xs font-bold text-info">おすすめ</span>
      <p className="min-w-0 flex-1 leading-[1.7] max-sm:order-last max-sm:basis-full">
        <b>コンセプトを決める</b>
        <span className="text-muted">：誰の・どんな悩みを・どう解決するかを 1 文にすると、投稿で迷いにくくなります</span>
      </p>
      <Link href={href} className="shrink-0 font-semibold whitespace-nowrap text-primary hover:underline max-sm:order-last">
        決める →
      </Link>
      <BandCloseButton
        label="コンセプトのおすすめを閉じる"
        className="max-sm:ml-auto"
        onClick={() => {
          setHidden(true);
          // 閉じたことを記録できなくても、画面全体をエラーにしない（この画面では消えたまま。読み込み直すとまた出る）
          startTransition(async () => {
            try {
              await closeConceptHint(projectId);
            } catch {}
          });
        }}
      />
    </aside>
  );
}
