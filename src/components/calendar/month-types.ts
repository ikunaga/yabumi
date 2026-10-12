import type { PostDisplayStatus } from "@/components/posts/post-chip";

// 月の表示に渡す、1 件の投稿の短い表示（サーバーで作り、スマホの月の表示（クライアント）にもそのまま渡す）
export type MonthItem = {
  id: string;
  href: string;
  time: string;
  sns: string;
  title: string;
  status: PostDisplayStatus;
  warning: string | null;
};

// 月のマスの 1 日
export type MonthDay = {
  ymd: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  // その日の投稿の数（DB で数えたもの。読んだ行の数ではない）
  count: number;
  items: MonthItem[];
};

// 凡例（● 予約・✓ 投稿済み・○ 下書き）と同じ印と色
export const MARK: Record<PostDisplayStatus, { char: string; className: string; dot: string; label: string }> = {
  scheduled: { char: "●", className: "font-bold text-signal", dot: "bg-signal", label: "予約" },
  posted: { char: "✓", className: "font-bold text-success", dot: "bg-success", label: "投稿済み" },
  draft: { char: "○", className: "text-muted", dot: "border border-muted", label: "下書き" },
  failed: { char: "!", className: "font-bold text-danger", dot: "bg-danger", label: "失敗あり" },
};
