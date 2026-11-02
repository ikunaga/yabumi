"use client";

import { Button } from "./button";
import { draftTimeLabel } from "@/lib/form-draft";

// 「保存していない書きかけがあります」の帯（docs/architecture.md の 4.35）。戻すか捨てるかを選んでもらう（黙って上書きも捨てもしない）
export function DraftRestoreBar({ at, onRestore, onDiscard, what = "書きかけ" }: { at: number; onRestore: () => void; onDiscard: () => void; what?: string }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface2 px-4 py-3 text-sm leading-[1.7]">
      <span className="min-w-0 flex-[1_1_16rem]">
        <b>保存していない{what}があります</b>（{draftTimeLabel(at)}）。この端末に残っていたものです。
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Button type="button" size="sm" onClick={onRestore}>
          戻す
        </Button>
        <Button type="button" variant="text" size="sm" onClick={onDiscard}>
          捨てる
        </Button>
      </span>
    </div>
  );
}
