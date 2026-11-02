// 「AI で作った画像」の札（画面で、AI で作ったことを知らせる。D25 の I5・D35）
export function AiBadge({ className = "" }: { className?: string }) {
  return <span className={`inline-block rounded-sm border border-line bg-surface px-1.5 py-0.5 text-[11px] font-bold leading-none text-fg ${className}`}>AI で作った画像</span>;
}
