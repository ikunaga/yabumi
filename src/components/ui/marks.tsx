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

// SNS 札: ロゴは使わず名前で表す。SNS ごとの色の点を添える
export function SnsTag({ sns }: { sns: SnsKey }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs leading-none font-bold text-fg">
      <span aria-hidden className={`size-1.5 rounded-full ${SNS_COLOR[sns].bg}`} />
      {SNS[sns].label}
    </span>
  );
}

// SNS の小さな印。SNS ごとの色の点と、名前を全部書く（「● Threads」）。略（IG・TH など）は使わない（2026-11-21 PM・オーナー）
// dotOnly: 幅が足りないところ（カレンダーの日ごとの札・概要の次の予約）だけ、色の点だけにして、名前は title と読み上げで伝える
// byHand: 自動では送らず、利用者が手で投稿する（「X は手で投稿する」を選んだ X）。点に点線の輪を付け、「手で」を添える
export function SnsMark({ sns, byHand = false, dotOnly = false }: { sns: SnsKey; byHand?: boolean; dotOnly?: boolean }) {
  const c = SNS_COLOR[sns];
  const name = byHand ? `${SNS[sns].label}・手動で投稿` : SNS[sns].label;
  const dot = <span aria-hidden className={`size-2 shrink-0 rounded-full ${c.bg} ${byHand ? "ring-1 ring-current ring-offset-1 ring-offset-surface" : ""}`} />;
  if (dotOnly) {
    return (
      <span title={name} className="inline-flex h-5 shrink-0 items-center px-0.5 text-muted">
        {dot}
        <span className="sr-only">{name}</span>
      </span>
    );
  }
  return (
    <span title={name} className="inline-flex h-5 shrink-0 items-center gap-1 text-[12px] leading-none font-bold whitespace-nowrap text-fg">
      {dot}
      {SNS[sns].label}
      {byHand && <span className="font-normal text-muted">・手動</span>}
    </span>
  );
}

// 幅が足りないところで、最初の SNS の印と「ほか n」だけを出す（「● X ほか 2」）。全部の名前は title と読み上げで伝える。
// 色の点だけだと、スマホでは title が見られず、どの SNS かわからなかった（2026-11-21 確認役の指摘・PM の判断）
export function SnsMarksCompact({ sns }: { sns: SnsKey[] }) {
  if (sns.length === 0) return null;
  const names = sns.map((s) => SNS[s].label).join("・");
  return (
    <span title={names} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
      <span aria-hidden className="inline-flex items-center gap-1">
        <SnsMark sns={sns[0]} />
        {sns.length > 1 && <span className="text-[12px] text-muted">ほか {sns.length - 1} つ</span>}
      </span>
      <span className="sr-only">{names}</span>
    </span>
  );
}

export type PostStatus = "scheduled" | "posted" | "draft" | "failed";

const statusStyle: Record<PostStatus, { text: string; className: string }> = {
  scheduled: { text: "● 予約", className: "font-bold text-signal" },
  posted: { text: "✓ 送信済み", className: "font-bold text-success" },
  draft: { text: "○ 下書き", className: "text-muted" },
  failed: { text: "! 失敗", className: "font-bold text-danger" },
};

export function StatusMark({ status }: { status: PostStatus }) {
  const s = statusStyle[status];
  return <span className={`text-sm whitespace-nowrap ${s.className}`}>{s.text}</span>;
}
