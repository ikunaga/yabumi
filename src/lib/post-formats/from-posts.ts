// 伸びた投稿からフォーマットの案をつくるときの数の決まり（docs/design/winning-posts.md の 4.1）。画面とサーバーの両方から読む
// （AI を呼ぶところは src/lib/ai/format-from-posts.ts。そちらはサーバーだけ）

// 案の数・1 回に選べる投稿の数・1 本あたりに AI へ送る字数
export const FROM_POSTS_PROPOSALS = 2;
export const MAX_SOURCE_POSTS = 5;
export const SOURCE_POST_CHARS = 300;
