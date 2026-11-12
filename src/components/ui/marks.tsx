import type { SnsKey } from "@/lib/sns";
import { SNS } from "@/lib/sns";

// SNS ごとの色（globals.css の --sns-*）。Tailwind はクラス名をそのまま探すので、組み立てずに書き並べる
export const SNS_COLOR: Record<SnsKey, { text: string; bg: string; border: string }> = {
  x: { text: "text-sns-x", bg: "bg-sns-x", border: "border-sns-x" },
  instagram: { text: "text-sns-instagram", bg: "bg-sns-instagram", border: "border-sns-instagram" },
  threads: { text: "text-sns-threads", bg: "bg-sns-threads", border: "border-sns-threads" },
  facebook: { text: "text-sns-facebook", bg: "bg-sns-facebook", border: "border-sns-facebook" },
  tiktok: { text: "text-sns-tiktok", bg: "bg-sns-tiktok", border: "border-sns-tiktok" },
  youtube: { text: "text-sns-youtube", bg: "bg-sns-youtube", border: "border-sns-youtube" },
  note: { text: "text-sns-note", bg: "bg-sns-note", border: "border-sns-note" },
  substack: { text: "text-sns-substack", bg: "bg-sns-substack", border: "border-sns-substack" },
};

// 狭いところに出す短い名前（カレンダーの札、予約の一覧）
export const SNS_SHORT: Record<SnsKey, string> = {
  x: "X",
  instagram: "IG",
  threads: "TH",
  facebook: "FB",
  tiktok: "TT",
  youtube: "YT",
  note: "note",
  substack: "SS",
};

// SNS 札: ロゴは使わず名前で表す。SNS ごとの色の点を添える
export function SnsTag({ sns }: { sns: SnsKey }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs leading-none font-bold text-fg">
      <span aria-hidden className={`size-1.5 rounded-full ${SNS_COLOR[sns].bg}`} />
      {SNS[sns].label}
    </span>
  );
}

// SNS の小さな印（X・IG など）。SNS ごとの色の枠と字。短い名前の意味は title と読み上げで補う
// byHand: 自動では送らず、利用者が手で投稿する（「X は手で投稿する」を選んだ X）。点線の枠と「手で」を添える
export function SnsMark({ sns, byHand = false }: { sns: SnsKey; byHand?: boolean }) {
  const c = SNS_COLOR[sns];
  return (
    <span
      title={byHand ? `${SNS[sns].label}（手で投稿）` : SNS[sns].label}
      className={`inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-[11px] leading-none font-bold ${byHand ? "border-dashed" : ""} ${c.border} ${c.text}`}
    >
      <span aria-hidden>{SNS_SHORT[sns]}</span>
      {byHand && <span className="ml-1 font-normal">手で</span>}
      <span className="sr-only">{byHand ? `${SNS[sns].label}（手で投稿）` : SNS[sns].label}</span>
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
