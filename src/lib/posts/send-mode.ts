// 投稿の画面の下のボタンの出し分け（送った投稿の画面で、押せない「予約する」を出さない。PM の通し確認 2026-10-30）
// - new: まだどの SNS にも送っていない → 予約する・今すぐ送る・下書きに保存する
// - partial: 一部の SNS だけ送った → 残りの SNS の分だけ予約・送る（送った SNS は送り直さない）
// - all_sent: 選んだ SNS にすべて送った（送信中・取り消し済みを含む）→ ボタンを出さず、1 行の案内と「yabumi から削除する」
export type SendMode = "new" | "partial" | "all_sent";

export function sendMode(a: { sentAny: boolean; toSend: number }): SendMode {
  if (!a.sentAny) return "new";
  return a.toSend > 0 ? "partial" : "all_sent";
}

export function sendLabels(mode: SendMode, toSend: number): { schedule: string; now: string } {
  if (mode === "partial") return { schedule: `残りの ${toSend} つの SNS に予約する`, now: "残りを今すぐ送る" };
  return { schedule: toSend > 0 ? `${toSend} つの SNS に予約する` : "予約する", now: "今すぐ送る" };
}

type SentStatus = "pending" | "preparing" | "publishing" | "published" | "failed" | "deleted";

// 送った配信先の状態の出し方。text: 行やチップに出す言葉、plain: 文の中に入れるときの言葉（印を付けない。⑤ のまとめの「Threads（送信中）」など）
export const TARGET_STATE: Partial<Record<SentStatus, { text: string; plain: string; tone: string }>> = {
  published: { text: "✓ 投稿済み", plain: "投稿済み", tone: "font-bold text-success" },
  preparing: { text: "送信中", plain: "送信中", tone: "text-muted" },
  publishing: { text: "送信中", plain: "送信中", tone: "text-muted" },
  deleted: { text: "取り消し済み", plain: "取り消し済み", tone: "text-muted" },
  failed: { text: "! 失敗", plain: "失敗", tone: "font-bold text-danger" },
};
const RETRY_STATE = { text: "送り直し待ち", plain: "送り直し待ち", tone: "font-bold text-signal" };

// 送った配信先のいまの本当の状態（送信中・失敗・送り直し待ち・投稿済み・取り消し済み）。まだ送っていなければ null。
// ② の送り先と ⑤ のまとめに出す（送っている途中を「投稿済み」と出さない。2026-11-12 PMO の通しのテスト）
export function sentStateOf(r: { status: SentStatus; errorMessage: string | null } | undefined): { text: string; plain: string; tone: string } | null {
  if (!r) return null;
  if (r.status === "pending") return r.errorMessage ? RETRY_STATE : null;
  return TARGET_STATE[r.status] ?? null;
}
