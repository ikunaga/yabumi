"use client";

import { Button } from "./button";
import { HelpTip } from "./help";
import { FORM_DRAFT_DAYS, draftTimeLabel } from "@/lib/form-draft";

// 「保存していない書きかけがあります」の帯（docs/architecture.md の 4.35）。戻すか捨てるかを選んでもらう（黙って上書きも捨てもしない）
// compact: 画面の下に浮かせる短い形（「この端末に残っていたもの」は「?」に畳む。投稿をつくる）
// note: 時刻のあとに添える一言（画像を戻せないことがある、など）
export function DraftRestoreBar({
  at,
  onRestore,
  onDiscard,
  what = "書きかけ",
  note,
  compact = false,
}: {
  at: number;
  onRestore: () => void;
  onDiscard: () => void;
  what?: string;
  note?: string;
  compact?: boolean;
}) {
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface2 text-sm leading-[1.7] ${compact ? "px-4 py-2" : "px-4 py-3"}`}>
      <span className={`min-w-0 ${compact ? "flex-[1_1_12rem]" : "flex-[1_1_16rem]"}`}>
        <b>保存していない{what}があります</b>
        {/* 一言を添えるときは、スマホの幅では時刻を省く（帯が 3 行になって、下の欄に重ならないように） */}
        <span className={note ? "max-sm:hidden" : ""}>。{draftTimeLabel(at)} に書いたものです</span>
        {compact ? "。" : "。この端末に残っていたものです。"}
        {note && <span className="text-muted max-sm:ml-1">{note}</span>}
        {/* いつ消えるかを添える（2026-11-09 オーナーの指摘「端末に残ってる書きかけのやついつ消える」） */}
        <HelpTip label="書きかけはいつ消えるか" align="right">
          {compact && "この端末に残っていたものです。"}
          欄に書いた内容が開いたときと違うと、保存するまでの書きかけを残します。キーボードでも声でも同じです。残すのは、この端末のブラウザーの中だけです。ボタンで入れた文だけのときは残しません。URL や AI の案などです。ほかの端末には出ません。書いてから {FORM_DRAFT_DAYS} 日たつと消えます。ログアウト・退会したときと、「書きかけを消す」を押したときも消えます。保存・予約したときも消えます。そのあとほかの画面や AI の案で保存し直したときも、前の書きかけは出しません。
        </HelpTip>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Button type="button" size="sm" onClick={onRestore}>
          書きかけを入れる
        </Button>
        <Button type="button" variant="text" size="sm" onClick={onDiscard}>
          書きかけを消す
        </Button>
      </span>
    </div>
  );
}
