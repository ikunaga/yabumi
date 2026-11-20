import Link from "next/link";
import { chipClass, chipSolidClass } from "@/components/ui/chip";
import { HelpTip } from "@/components/ui/help";

// 「投稿をつくる」の見出しの横の選び方。自分で書く（この画面。AI を使わない）・AI とネタを出す（/ideas）・ネタ帳から（この画面でメモを選んで本文に入れる）を
// 同じ大きさの札で並べる（見本 B に合わせて小さく）。
// 自動の投稿の入口はここに置かない（1 本を書く流れの中では、ややこしくなるため。2026-11-18 オーナーの指示。docs/design/auto-post.md の 1.2）
export function ComposeStart({
  projectId,
  aiEnabled,
  notesOpen,
  onNotes,
  formatsOpen,
  onFormats,
}: {
  projectId: string;
  aiEnabled: boolean;
  notesOpen: boolean;
  onNotes: () => void;
  formatsOpen: boolean;
  onFormats: () => void;
}) {
  return (
    <nav aria-label="投稿のつくり方" className="flex flex-wrap items-center gap-2">
      <span aria-current="page" className={chipSolidClass(true)}>
        自分で書く
      </span>
      <span className="inline-flex items-center gap-1.5">
        <button type="button" aria-expanded={formatsOpen} aria-controls="compose-formats" onClick={onFormats} className={chipClass({ on: formatsOpen })}>
          フォーマットから書く
        </button>
        {/* yabumi の機能の名前は、初めて出るここで「?」に何をするものかを書く（用語集には入れない。2026-11-21 PM） */}
        <HelpTip label="フォーマットとは">毎回くり返し使う投稿のひな形です。空欄に言葉を入れるだけで、いつもの形の投稿が書けます。</HelpTip>
      </span>
      {aiEnabled ? (
        <Link href={`/projects/${projectId}/ideas`} className={`${chipClass()} hover:no-underline`}>
          AI とネタを出す →
        </Link>
      ) : (
        <span aria-disabled className={`${chipClass()} pointer-events-none opacity-60`}>
          AI とネタを出す<span className="text-xs">まだ使えません</span>
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <button type="button" aria-expanded={notesOpen} aria-controls="compose-notes" onClick={onNotes} className={chipClass({ on: notesOpen })}>
          ネタ帳のメモから書く
        </button>
        <HelpTip label="ネタ帳とは">思いついたことを「＋ メモ」で残しておく場所です。あとでメモを選ぶと、その中身から投稿を書き始められます。</HelpTip>
      </span>
    </nav>
  );
}
