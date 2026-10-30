// 投稿の画面の下のボタンの出し分け（送った投稿の画面で、押せない「予約する」を出さない。PM の通し確認 2026-10-30）
// - new: まだどの SNS にも送っていない → 予約する・今すぐ送る・下書きに保存する
// - partial: 一部の SNS だけ送った → 残りの SNS の分だけ予約・送る（送った SNS は送り直さない）
// - all_sent: 選んだ SNS にすべて送った（送信中・取り消し済みを含む）→ ボタンを出さず、1 行の案内と「矢書から削除する」
export type SendMode = "new" | "partial" | "all_sent";

export function sendMode(a: { sentAny: boolean; toSend: number }): SendMode {
  if (!a.sentAny) return "new";
  return a.toSend > 0 ? "partial" : "all_sent";
}

export function sendLabels(mode: SendMode, toSend: number): { schedule: string; now: string } {
  if (mode === "partial") return { schedule: `残りの ${toSend} つの SNS に予約する`, now: "残りを今すぐ送る" };
  return { schedule: toSend > 0 ? `${toSend} つの SNS に予約する` : "予約する", now: "今すぐ送る" };
}
