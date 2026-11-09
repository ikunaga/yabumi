"use client";

import { Button } from "./button";
import { HelpTip } from "./help";
import { FORM_DRAFT_DAYS, draftTimeLabel } from "@/lib/form-draft";

// 「保存していない書きかけがあります」の帯（docs/architecture.md の 4.35）。戻すか捨てるかを選んでもらう（黙って上書きも捨てもしない）
export function DraftRestoreBar({ at, onRestore, onDiscard, what = "書きかけ" }: { at: number; onRestore: () => void; onDiscard: () => void; what?: string }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface2 px-4 py-3 text-sm leading-[1.7]">
      <span className="min-w-0 flex-[1_1_16rem]">
        <b>保存していない{what}があります</b>（{draftTimeLabel(at)}）。この端末に残っていたものです。
        {/* いつ消えるかを添える（2026-11-09 オーナーの指摘「端末に残ってる書きかけのやついつ消える」） */}
        <HelpTip label="書きかけはいつ消えるか" align="right">
          開いたときの内容から 1 文字でも変わると、保存するまでの書きかけを、この端末（ブラウザー）にだけ残します。ほかの端末には出ません。次のときに消えます。書いてから {FORM_DRAFT_DAYS} 日たったとき、ログアウト・退会したとき、「捨てる」を押したとき、保存・予約したとき。
        </HelpTip>
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
