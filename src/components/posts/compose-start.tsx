import Link from "next/link";
import { chipClass, chipSolidClass } from "@/components/ui/chip";

// 「投稿をつくる」の見出しの横の選び方。自分で書く（この画面。AI を使わない）・AI とネタを出す（/ideas）・ネタ帳から（この画面でメモを選んで本文に入れる）を
// 同じ大きさの札で並べる（見本 B に合わせて小さく）。
// 「↻ 自動で回す」は AI とネタを出すの隣（自動の投稿の入口。docs/design/auto-post.md の 1.2）。autoHref を渡したときだけ出す
export function ComposeStart({
  projectId,
  aiEnabled,
  autoHref,
  notesOpen,
  onNotes,
}: {
  projectId: string;
  aiEnabled: boolean;
  autoHref?: string;
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
      {/* 自動の投稿は AI が文を作るので、AI を使えないときは AI とネタを出すと同じく押せない */}
      {autoHref &&
        (aiEnabled ? (
          <Link href={autoHref} className={`${chipClass()} hover:no-underline`}>
            <span aria-hidden className="text-primary">
              ↻
            </span>{" "}
            自動で回す →
          </Link>
        ) : (
          <span aria-disabled className={`${chipClass()} pointer-events-none opacity-60`}>
            ↻ 自動で回す<span className="text-xs">準備中</span>
          </span>
        ))}
      <button type="button" aria-expanded={notesOpen} aria-controls="compose-notes" onClick={onNotes} className={chipClass({ on: notesOpen })}>
        ネタ帳から
      </button>
    </nav>
  );
}
