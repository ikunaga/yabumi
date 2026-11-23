import type { PostDisplayStatus } from "@/components/posts/post-chip";
import type { CalendarTodo } from "@/lib/calendar/roadmap-view";
import type { SnsKey } from "@/lib/sns";

// カレンダーの札の状態。planned は作る前の自動の回（投稿はまだない。下書きとは別の印にする）
export type CalendarStatus = PostDisplayStatus | "planned";

// 月の表示に渡す、1 件の投稿の短い表示（サーバーで作り、スマホの月の表示（クライアント）にもそのまま渡す）
export type MonthItem = {
  id: string;
  href: string;
  time: string;
  sns: string;
  // 送り先の SNS（札の色の点）
  snsKeys: SnsKey[];
  title: string;
  status: CalendarStatus;
  warning: string | null;
  // 自動の回（「↻」を付ける）。作る前の回は status が planned で、href は回し方の画面
  auto?: boolean;
  // 状態の言葉の差し替え（作る前の自動の回は「自動でつくって送る投稿」）
  statusLabel?: string;
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
  // 予定日がこの日のロードマップのタスク
  todos: CalendarTodo[];
};

// 凡例（● 予約・✓ 送信済み・○ 下書き・↻ 自動でつくって送る投稿）と同じ印と色
export const MARK: Record<CalendarStatus, { char: string; className: string; dot: string; label: string }> = {
  scheduled: { char: "●", className: "font-bold text-signal", dot: "bg-signal", label: "予約" },
  posted: { char: "✓", className: "font-bold text-success", dot: "bg-success", label: "送信済み" },
  draft: { char: "○", className: "text-muted", dot: "border border-muted", label: "下書き" },
  failed: { char: "!", className: "font-bold text-danger", dot: "bg-danger", label: "失敗あり" },
  // 情報の色（info）の「↻」。予約の「●」（signal）・下書きの灰色の点線と紛れないよう、点ではなく字で出す。
  // primary（押すもの）は黒に近く、下書きの点線と見分けにくかったので使わない（2026-11-23 撮って確かめた）
  planned: { char: "↻", className: "font-bold text-info", dot: "", label: "自動でつくって送る投稿" },
};

// 作る前の自動の回の枠・札（情報の色の点線と、その薄い地。下書きの灰色の点線・白い丸と見分ける）
export const PLANNED_CARD = "border border-dashed border-info bg-info-soft";
// 作る前の自動の回の「↻」と「自動でつくって送る投稿」の字の色
export const PLANNED_TEXT = "text-info";
