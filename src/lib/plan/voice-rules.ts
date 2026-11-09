// 過去の自分の投稿から文調をそろえる機能の決まり（docs/design/voice-from-posts.md）。画面とサーバーの両方から読む

// 自分で書いて送った投稿が何本たまったら、文調のメモをつくれるか（2026-11-09 PM の了承 Q4）
export const SELF_WRITTEN_ENOUGH = 5;

// 書き方（文調のメモ）を AI に読み取ってもらえる回数（1 日。2026-11-09 PM の了承 Q5。利用者ごとに、消せない利用量の記録で数える）
export const VOICE_MEMO_DAILY_RUNS = 3;
// 材料にする投稿の本数と、1 本の長さ（AI に送る分）
export const VOICE_MATERIAL_POSTS = 30;
export const VOICE_MATERIAL_CHARS = 600;
// AI に見せる例の投稿の 1 本の長さ
export const VOICE_EXAMPLE_CHARS = 400;
