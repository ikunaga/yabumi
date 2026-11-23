// 自動投稿のジョブが止まっていて、まだつくっていない自動投稿があるときの帯（カレンダーと自動投稿の画面の上）。
// 利用者がすることはないので「要確認」の印は付けない（2026-11-23 ja-copy-reviewer）。止まっている間に時刻を過ぎた回は、あとから作らない（autoRunsRange）
export function AutoPostStoppedBanner() {
  return (
    <div role="status" className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-5 py-3 max-sm:px-4">
      <p className="text-[15px] font-bold">yabumi の運営が、自動投稿をいま止めています</p>
      <p className="text-sm text-muted">
        時刻が来ても、投稿はつくられません。止めている間の投稿は、あとから送られません。「● 予約」の札が付いた投稿は、予定どおり送られます。あなたがすることはありません。
      </p>
    </div>
  );
}
