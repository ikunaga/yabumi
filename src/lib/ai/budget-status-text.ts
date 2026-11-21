// AI の枠の状態（DB の ai_budget_status）を、画面の帯の文にする。金額は出さない（料金を誰が払うかはオーナーの決定待ち。2026-11-21）
// 画面からも読むので、サーバーの部品は入れない。「枠」は予約の枠と取り違えやすいので、画面では「AI を使える量」と書く（確認役の指摘）

export type AiBudgetState = { status: string; availableFrom: string | null; low: boolean };

// 画面ごとに、止まっていることと、できること（例: 相談の画面は「相談できます」「これまでの相談は読めます。」）
export type AiBlockedWords = { can: string; still?: string };
export const CONSULT_BLOCKED_WORDS: AiBlockedWords = { can: "相談できます", still: "これまでの相談は読めます。" };
// ネタを出す
export const IDEAS_BLOCKED_WORDS: AiBlockedWords = { can: "ネタを出せます", still: "これまでに出したネタは読めます。" };
// アカウントの方針の「AI と考える」
export const PLAN_COACH_BLOCKED_WORDS: AiBlockedWords = { can: "AI と考えられます", still: "アカウントの方針は、手で編集できます。" };

// 「12 月 1 日」（日本時間の日付 YYYY-MM-DD から）
function dayLabel(ymd: string): string {
  return `${Number(ymd.slice(5, 7))} 月 ${Number(ymd.slice(8, 10))} 日`;
}

// 使えないときの文（使えるときは null）。全体の上限は、利用者のせいに見えない言い方にする（2026-11-21 PM の指示）
export function aiBlockedText(s: AiBudgetState, words: AiBlockedWords = CONSULT_BLOCKED_WORDS): string | null {
  if (s.status === "ok") return null;
  const again = `${s.availableFrom ? `${dayLabel(s.availableFrom)}から、` : ""}また${words.can}。`;
  const still = words.still ?? "";
  switch (s.status) {
    case "user_limit":
      return `今月、AI を使える量を使い切りました。${again}${still}`;
    case "new_user_limit":
      return `登録から 7 日間に使える AI の量を、使い切りました。${again}${still}`;
    case "global_limit":
    case "new_global_limit":
      return `yabumi を使う人みんなで、今月の AI の上限に達しました。あなたが使った量とは関係ありません。${again}${still}`;
    default:
      // 1 日の上限（往復の数・用途ごとの回数）
      return `今日の AI の回数を使い切りました。明日から、また${words.can}。${still}`;
  }
}

export const AI_LOW_TEXT = "今月 AI を使える量は、残りわずかです。来月 1 日に、また増えます。";
