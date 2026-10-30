import Link from "next/link";
import { SNS_COLOR } from "@/components/ui/marks";
import { SNS, type SnsKey } from "@/lib/sns";
import type { PostDisplayStatus } from "@/components/posts/post-chip";

// カレンダーの札の薄い地（SNS の色。見本 C）。Tailwind はクラス名をそのまま探すので、組み立てずに書き並べる
export const SNS_TINT: Record<SnsKey, string> = {
  x: "bg-sns-x/12",
  instagram: "bg-sns-instagram/12",
  threads: "bg-sns-threads/12",
  facebook: "bg-sns-facebook/12",
  tiktok: "bg-sns-tiktok/12",
  youtube: "bg-sns-youtube/12",
  note: "bg-sns-note/12",
  substack: "bg-sns-substack/12",
};

const STATUS: Record<PostDisplayStatus, { mark: string; className: string; label: string }> = {
  scheduled: { mark: "", className: "", label: "予約" },
  posted: { mark: "✓", className: "text-success", label: "投稿済み" },
  failed: { mark: "!", className: "text-danger", label: "失敗あり" },
  draft: { mark: "", className: "", label: "下書き" },
};

// 1 件の投稿の札: SNS の色の点（送り先の数だけ）・時刻・題。地は最初の SNS の色を薄く。下書きは点線の枠で色を付けない
export function SnsLabel({
  href,
  sns,
  status,
  time,
  title,
  dim = false,
}: {
  href: string;
  sns: SnsKey[];
  status: PostDisplayStatus;
  time?: string;
  title: string;
  dim?: boolean;
}) {
  const s = STATUS[status];
  const look = status === "draft" || sns.length === 0 ? "border border-dashed border-input text-muted" : `${SNS_TINT[sns[0]]} text-fg`;
  return (
    <Link
      href={href}
      title={`${title}（${sns.map((k) => SNS[k].label).join("・") || "送り先なし"}・${s.label}）`}
      className={`relative z-10 flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-[3px] text-[12px] leading-[1.35] font-bold hover:no-underline hover:brightness-95 ${look} ${dim ? "opacity-60" : ""}`}
    >
      <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
        {sns.slice(0, 3).map((k) => (
          <span key={k} className={`size-1.5 rounded-full ${SNS_COLOR[k].bg}`} />
        ))}
      </span>
      {s.mark && (
        <span aria-hidden className={`shrink-0 ${s.className}`}>
          {s.mark}
        </span>
      )}
      <span className="sr-only">{s.label}</span>
      {time && <span className="num shrink-0 font-normal text-muted">{time}</span>}
      <span className="truncate">{title}</span>
    </Link>
  );
}
