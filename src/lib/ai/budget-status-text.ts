// AI の枠の状態（DB の ai_budget_status）を、画面の帯の文にする。金額は出さない（料金を誰が払うかはオーナーの決定待ち。2026-11-21）
// 画面からも読むので、サーバーの部品は入れない。「枠」は予約の枠と取り違えやすいので、画面では「AI を使える量」と書く（確認役の指摘）

export type AiBudgetState = { status: string; availableFrom: string | null; low: boolean };

// 画面ごとに、止まっていることと、できること（例: 相談の画面は「相談できます」「これまでの相談は読めます。」）
export type AiBlockedWords = { can: string; still?: string };
export const CONSULT_BLOCKED_WORDS: AiBlockedWords = { can: "相談できます", still: "これまでの相談は読めます。" };
// ネタを出す
export const IDEAS_BLOCKED_WORDS: AiBlockedWords = { can: "AI とネタを出せます", still: "「自分で書く」なら、いまも投稿をつくれます。" };
// 投稿をつくるの中の AI のボタン（整える・AI っぽさ・画像の文字・絵の説明）
export const COMPOSE_BLOCKED_WORDS: AiBlockedWords = { can: "AI を使えます", still: "自分で書いた文は、このまま投稿できます。" };
// フォーマットを AI とつくる
export const FORMAT_AI_BLOCKED_WORDS: AiBlockedWords = { can: "AI を使えます", still: "「やめる」を押して「新しいフォーマットを自分で書く」から、自分でつくれます。" };
// アカウントの方針の「AI と考える」
export const PLAN_COACH_BLOCKED_WORDS: AiBlockedWords = { can: "AI と考えられます", still: "「決まった中身を見る」から、自分で編集できます。" };

// 「12 月 1 日」（日本時間の日付 YYYY-MM-DD から）
function dayLabel(ymd: string): string {
  return `${Number(ymd.slice(5, 7))} 月 ${Number(ymd.slice(8, 10))} 日`;
}

// 使えないときの文（使えるときは null）。全体の上限は、利用者のせいに見えない言い方にする（2026-11-21 PM の指示）
export function aiBlockedText(s: AiBudgetState, words: AiBlockedWords = CONSULT_BLOCKED_WORDS): string | null {
  if (s.status === "ok") return null;
  // 「また」のあとが英字（AI など）なら、間に空白を入れる（「また AI と考えられます」）
  const can = /^[A-Za-z]/.test(words.can) ? ` ${words.can}` : words.can;
  const again = `${s.availableFrom ? `${dayLabel(s.availableFrom)}から、` : ""}また${can}。`;
  const still = words.still ?? "";
  switch (s.status) {
    case "user_limit":
      return `今月、AI を使える量を使い切りました。${again}${still}`;
    case "new_user_limit":
      // 登録から 7 日間の枠。「7 日間」と書くと、そのあとお金がかかるように読めるので書かない（確認役の指摘）
      return `AI を使える量を、使い切りました。${again}${still}`;
    case "global_limit":
    case "new_global_limit":
      return `yabumi を使う人みんなで、今月の AI の上限に達しました。あなたが使った量とは関係ありません。${again}${still}`;
    default:
      // 1 日の上限（往復の数・用途ごとの回数）
      return `今日の AI の回数を使い切りました。明日から、また${can}。${still}`;
  }
}

export const AI_LOW_TEXT = "今月 AI を使える量は、残りわずかです。来月 1 日に、また増えます。";
