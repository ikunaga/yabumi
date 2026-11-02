import Link from "next/link";
import { chipClass, chipSolidClass } from "@/components/ui/chip";

// 「投稿をつくる」の見出しの横の選び方。自分で書く（この画面。AI を使わない）・AI とネタを出す（/ideas）・ネタ帳から（この画面でメモを選んで本文に入れる）を
// 同じ大きさの札で並べる（見本 B に合わせて小さく）
export function ComposeStart({
  projectId,
  aiEnabled,
  notesOpen,
  onNotes,
}: {
  projectId: string;
  aiEnabled: boolean;
  notesOpen: boolean;
  onNotes: () => void;
}) {
  return (
    <nav aria-label="投稿のつくり方" className="flex flex-wrap items-center gap-2">
      <span aria-current="page" className={chipSolidClass(true)}>
        自分で書く
      </span>
      {aiEnabled ? (
        <Link href={`/projects/${projectId}/ideas`} className={`${chipClass()} hover:no-underline`}>
          AI とネタを出す →
        </Link>
      ) : (
        <span aria-disabled className={`${chipClass()} pointer-events-none opacity-60`}>
          AI とネタを出す<span className="text-xs">準備中</span>
        </span>
      )}
      <button type="button" aria-expanded={notesOpen} aria-controls="compose-notes" onClick={onNotes} className={chipClass({ on: notesOpen })}>
        ネタ帳から
      </button>
    </nav>
  );
}
