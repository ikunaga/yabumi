// 読む人の悩み・望みの 4 つ（HARM。docs/architecture.md の 4.64。用語集の harm）。
// 投稿が読む人のどの悩みに触れるかを決めると「自分のことだ」と思ってもらいやすい、という考え方を、ネタ出し・相談・設計の相棒の
// 指示（system。固定の文）に入れる。整える（tidy-draft）には入れない（利用者の文の並べ方だけを決めるので、悩みの切り口を足すと、
// 材料にない話を作り足しやすくなる）。書く中身の決まり（content-rules.ts）のあと、日本語の書き方の決まりの前に置く

export const READER_CONCERNS = ["health", "ambition", "relationship", "money"] as const;
export type ReaderConcern = (typeof READER_CONCERNS)[number];

// 画面の札（「悩み: 人間関係」）に出す名前
export const READER_CONCERN_LABEL: Record<ReaderConcern, string> = {
  health: "健康・美容",
  ambition: "夢・仕事",
  relationship: "人間関係",
  money: "お金",
};

// AI が返した値を読む。4 つのどれでもなければ（none・前の版の返事・知らない値）、札を出さない
export function readerConcernOf(v: unknown): ReaderConcern | null {
  return typeof v === "string" && (READER_CONCERNS as readonly string[]).includes(v) ? (v as ReaderConcern) : null;
}

export const READER_CONCERNS_RULES = `# 読む人の悩み・望み（HARM）
人が強く気にする悩み・望みは、次の 4 つに分けられる。投稿が読む人のどれに触れるかを決めておくと、「自分のことだ」と思ってもらいやすい。
- health（健康・美容）: 体の不調、疲れ、見た目、食べ物の安心など
- ambition（夢・仕事・成長）: うまくなりたい、資格や仕事、好きなことを形にしたい、時間がほしいなど
- relationship（人間関係・恋愛・家族）: 家族や子ども、友だち、職場の人、ひとりの寂しさなど
- money（お金）: 節約、長く使えるか、払う価値があるか、収入など
使い方:
- 届けたい相手の困りごと（アカウント設計の「相手の困りごと」）が書いてあれば、それがどれに当たるかを見て使う。困りごとは相手が本当に持っているものだけを使い、書かれていない悩みを作らない
- 困りごとが書かれていなければ、材料から読み取れるときだけ選ぶ。わからないとき・お知らせなどどれにも当たらないときは、無理に当てはめない（none）
- 読む人に悩みを決めつけない（「〜で困っていますよね」と言い切らない）。読む人が自分から「わかる」と思える書き方にする
- 不安・劣等感・損を強めない（「このままでは〜」「知らないと損」「まだ〜していないの？」と、あおらない）
- 健康・美容の効き目、収入やもうけを約束したり、言い切ったりしない（薬機法・景品表示法・お金の広告の決まりに触れることがある）。上の「書く中身の決まり」が先`;
