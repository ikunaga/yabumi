"use client";

import Link from "next/link";
import { glossaryHref } from "@/lib/glossary/terms";
import { useState, useTransition } from "react";
import { BandCloseButton } from "@/components/ui/band-close";
import { dismissTodayTerm } from "@/lib/learning/actions";
import type { TodayTerm } from "@/lib/learning/today";

// 概要の「今日の用語」（4.47）。いまやることの帯の下の、小さな 1 行。「×」でその日は出さない（サーバーに閉じた日を記録する）
export function TodayTermBand({ projectId, term }: { projectId: string; term: TodayTerm }) {
  const [hidden, setHidden] = useState(false);
  const [, startTransition] = useTransition();
  if (hidden) return null;
  return (
    // PC は 1 行（説明は 1 行に切る）。スマホは「今日の用語」と「×」を上の行に、説明とくわしくを下の行に（説明は切らない）
    <aside aria-label="今日の用語" className="flex items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface px-4 py-2 text-sm max-sm:flex-wrap max-sm:px-3">
      <span className="shrink-0 rounded-sm bg-subtle px-1.5 py-0.5 text-xs font-bold text-muted">今日の用語</span>
      <p className="min-w-0 flex-1 truncate leading-[1.7] max-sm:order-last max-sm:basis-full max-sm:whitespace-normal">
        <b>{term.label}</b>
        <span className="text-muted">：{term.summary}</span>
        <Link href={glossaryHref(term.key)} className="ml-1 font-semibold whitespace-nowrap text-primary hover:underline sm:hidden">
          くわしく →
        </Link>
      </p>
      <Link href={glossaryHref(term.key)} className="shrink-0 font-semibold whitespace-nowrap text-primary hover:underline max-sm:hidden">
        くわしく →
      </Link>
      <BandCloseButton
        label="今日の用語を閉じる（今日はもう出しません）"
        className="max-sm:ml-auto"
        onClick={() => {
          setHidden(true);
          // 閉じたことを記録できなくても、画面全体をエラーにしない（この画面では消えたまま。読み込み直すとまた出る）
          startTransition(async () => {
            try {
              await dismissTodayTerm(projectId);
            } catch {}
          });
        }}
      />
    </aside>
  );
}
