import Link from "next/link";
import { HOLD_TITLE, holdBody } from "@/lib/auto-post/holds";

// 運営者が、本人の自動の投稿を止めているときの帯（docs/design/auto-post.md の「運営者が止める」）。自動の投稿の画面の上（auto/layout.tsx）に出す。
// 理由は出さない（運営者がメールで伝える）。決まった文と問い合わせ先だけ
export function AutoPostHoldBanner({ heldAt }: { heldAt: string }) {
  return (
    <div role="status" className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-5 py-3 max-sm:px-4">
      <p className="text-[15px] font-bold">
        <span className="text-signal">● 要確認</span> {HOLD_TITLE}
      </p>
      <p className="text-sm text-muted">{holdBody(heldAt)}</p>
    </div>
  );
}

// 作る・直すの画面で、止めている間にウィザードの代わりに出す
export function HeldNotice({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4">
      <p className="text-[15px]">止めている間は、自動の投稿を作る・編集することはできません。</p>
      <Link href={`/projects/${projectId}/auto`} className="text-sm text-muted underline">
        ← 自動の投稿
      </Link>
    </div>
  );
}
