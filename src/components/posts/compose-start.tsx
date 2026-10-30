import Link from "next/link";
import { chipClass, chipSolidClass } from "@/components/ui/chip";

// 「投稿をつくる」の見出しの横の 2 つの選び方。自分で書く（この画面。AI を使わない）と、AI とネタを出す（/ideas）を同じ大きさの札で並べる（見本 B に合わせて小さく）
export function ComposeStart({ projectId, aiEnabled }: { projectId: string; aiEnabled: boolean }) {
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
    </nav>
  );
}
