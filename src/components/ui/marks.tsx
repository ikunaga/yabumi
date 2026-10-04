import type { SnsKey } from "@/lib/sns";
import { SNS } from "@/lib/sns";

// SNS 札: ロゴは使わず名前で表す
export function SnsTag({ sns }: { sns: SnsKey }) {
  return (
    <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-1 text-xs leading-none font-bold text-primary">
      {SNS[sns].label}
    </span>
  );
}

export type PostStatus = "scheduled" | "posted" | "draft" | "failed";

const statusStyle: Record<PostStatus, { text: string; className: string }> = {
  scheduled: { text: "● 予約", className: "font-bold text-signal" },
  posted: { text: "✓ 投稿済み", className: "font-bold text-success" },
  draft: { text: "○ 下書き", className: "text-muted" },
  failed: { text: "! 失敗", className: "font-bold text-danger" },
};

export function StatusMark({ status }: { status: PostStatus }) {
  const s = statusStyle[status];
  return <span className={`text-sm whitespace-nowrap ${s.className}`}>{s.text}</span>;
}
