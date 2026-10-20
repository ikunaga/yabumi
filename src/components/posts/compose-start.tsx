import Link from "next/link";

// 「投稿をつくる」を開いたときの上の 2 つの選び方。自分で書く（AI を使わない）と、AI とネタを出すを同じ重さで並べる。
// 自分で書くは、この画面の本文の欄へ移る。AI とネタを出すは、投稿のネタを出す画面（/ideas）へ
export function ComposeStart({ projectId, aiEnabled, bodyId }: { projectId: string; aiEnabled: boolean; bodyId: string }) {
  const card = "flex h-full flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3 text-left max-sm:px-3";
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-heading text-2xl font-bold">投稿をつくる</h1>
      <ul className="grid grid-cols-2 gap-3 max-sm:gap-2" aria-label="投稿のつくり方">
        <li>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById(bodyId);
              el?.scrollIntoView({ block: "center", behavior: "smooth" });
              el?.focus({ preventScroll: true });
            }}
            className={`${card} w-full hover:border-primary`}
          >
            <span className="font-bold text-primary">自分で書く ↓</span>
            <span className="text-xs leading-[1.7] text-muted">下の欄に書けば、AI を使わずにそのまま予約・送信できます。</span>
          </button>
        </li>
        <li>
          {aiEnabled ? (
            <Link href={`/projects/${projectId}/ideas`} className={`${card} hover:border-primary hover:no-underline`}>
              <span className="font-bold text-primary">AI とネタを出す →</span>
              <span className="text-xs leading-[1.7] text-muted">何を書くか迷うとき。AI が材料からネタと下書きを出します。</span>
            </Link>
          ) : (
            <div className={card} aria-disabled>
              <span className="font-bold text-muted">
                AI とネタを出す<span className="ml-2 text-xs font-normal">準備中</span>
              </span>
              <span className="text-xs leading-[1.7] text-muted">何を書くか迷うとき。AI が材料からネタと下書きを出します。</span>
            </div>
          )}
        </li>
      </ul>
    </div>
  );
}
