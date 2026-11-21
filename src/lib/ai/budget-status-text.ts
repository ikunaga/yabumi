// AI の枠の状態（DB の ai_budget_status）を、画面の帯の文にする。金額は出さない（料金を誰が払うかはオーナーの決定待ち。2026-11-21）
// 画面からも読むので、サーバーの部品は入れない

export type AiBudgetState = { status: string; availableFrom: string | null; low: boolean };

// 「12 月 1 日」（日本時間の日付 YYYY-MM-DD から）
function dayLabel(ymd: string): string {
  return `${Number(ymd.slice(5, 7))} 月 ${Number(ymd.slice(8, 10))} 日`;
}

// 使えないときの 1 行（使えるときは null）。全体の上限は、利用者のせいに見えない言い方にする（2026-11-21 PM の指示）
export function aiBlockedText(s: AiBudgetState): string | null {
  if (s.status === "ok") return null;
  const from = s.availableFrom ? `${dayLabel(s.availableFrom)}から、また使えます。` : "";
  switch (s.status) {
    case "user_limit":
      return `今月の AI の枠を使い切りました。${from}`;
    case "new_user_limit":
      return `登録して 7 日までの AI の枠を使い切りました。${from}`;
    case "global_limit":
    case "new_global_limit":
      return `いま、AI が混み合っていて使えません。${from}`;
    default:
      // 1 日の上限（往復の数・用途ごとの回数）
      return "今日の AI の回数を使い切りました。明日から、また使えます。";
  }
}

export const AI_LOW_TEXT = "今月の AI の枠は、残り少しです。";
