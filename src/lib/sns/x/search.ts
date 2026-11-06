import { z } from "zod";
import { X_PRICE_USD } from "./pricing";

// X の人気の投稿を yabumi の中で探す（A 案。docs/architecture.md の 4.52）。サーバーと画面の両方から読む、決まりと読み取り。
// X の recent search は人気の順に絞れないので、sort_order=relevancy で 10 件を取り、数字で並べ直す

// 1 回で読む投稿の数（API の最小。増やすと費用が増える）
export const X_SEARCH_MAX_RESULTS = 10;
// 1 回の最大の額: 投稿 10 件と、書いた人 最大 10 人（expansions=author_id のユーザーも 1 人ずつ読み取りとして請求される）。
// DB の reserve_x_search の c_cost_usd と同じ値
export const X_SEARCH_RESERVE_USD = X_SEARCH_MAX_RESULTS * X_PRICE_USD.x_search_read + X_SEARCH_MAX_RESULTS * X_PRICE_USD.x_search_user_read;
// 検索の言葉の長さ（利用者が入力欄で直した言葉も来る）
export const X_SEARCH_WORD_MAX = 80;
// 付ける演算子（日本語・リポストと返信を除く）
export const X_SEARCH_OPERATORS = "lang:ja -is:retweet -is:reply";

// 利用者の言葉から、演算子を作れる文字を除く（from:・url: などの演算子、括弧、引用符、先頭の「-」での除外）。空になれば null
export function xSearchWord(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[:()"“”]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^-+/, ""))
    .filter(Boolean)
    .join(" ")
    .slice(0, X_SEARCH_WORD_MAX)
    .trim();
  return cleaned || null;
}

export function xSearchQuery(word: string): string {
  return `${word} ${X_SEARCH_OPERATORS}`;
}

// recent search の URL のクエリ（直近 7 日。書いた人の名前・@・アイコンを一緒に取る。長い投稿は note_tweet に全文が入る）
export function xSearchParams(word: string): URLSearchParams {
  return new URLSearchParams({
    query: xSearchQuery(word),
    max_results: String(X_SEARCH_MAX_RESULTS),
    sort_order: "relevancy",
    "tweet.fields": "created_at,public_metrics,author_id,note_tweet",
    expansions: "author_id",
    "user.fields": "name,username,profile_image_url",
  });
}

const metricsSchema = z.object({
  like_count: z.number().int().nonnegative().catch(0),
  retweet_count: z.number().int().nonnegative().catch(0),
  quote_count: z.number().int().nonnegative().catch(0),
  reply_count: z.number().int().nonnegative().catch(0),
});
const tweetSchema = z.object({
  id: z.string().regex(/^\d{1,19}$/),
  text: z.string(),
  author_id: z.string().regex(/^\d{1,19}$/),
  created_at: z.string(),
  public_metrics: metricsSchema,
  note_tweet: z.object({ text: z.string() }).optional().catch(undefined),
});
const userSchema = z.object({
  id: z.string().regex(/^\d{1,19}$/),
  name: z.string(),
  username: z.string().regex(/^\w{1,15}$/),
  profile_image_url: z.string().optional().catch(undefined),
});
const responseSchema = z.object({
  data: z.array(z.unknown()).optional(),
  includes: z.object({ users: z.array(z.unknown()).optional() }).optional(),
});

// 一覧に出す 1 件（画面を開いている間だけ持つ。DB には保存しない）
export type XBuzzPost = {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  likes: number;
  reposts: number;
  quotes: number;
  replies: number;
  author: { name: string; username: string; profileUrl: string; imageUrl: string | null };
  score: number;
};

// 並べる基準: いいね ＋ (リポスト ＋ 引用) × 2 ＋ 返信。広げてくれた数を重く見る。同じなら新しい順
export function xBuzzScore(m: { likes: number; reposts: number; quotes: number; replies: number }): number {
  return m.likes + (m.reposts + m.quotes) * 2 + m.replies;
}

// X の本文の文字参照（&amp; &lt; &gt;）だけを戻す。中身は変えない（表示の決まり）
function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// アイコンは X の画像のサーバー（pbs.twimg.com）の https のものだけ
function safeImageUrl(u: string | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname === "pbs.twimg.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

export type XSearchParsed = { posts: XBuzzPost[]; postCount: number; userCount: number };

// 応答を読む。形の合わない投稿・書いた人の見つからない投稿は出さない（費用の件数には、返ってきた数をそのまま数える）
export function parseXSearch(json: unknown): XSearchParsed | null {
  const r = responseSchema.safeParse(json);
  if (!r.success) return null;
  const rawTweets = r.data.data ?? [];
  const rawUsers = r.data.includes?.users ?? [];
  const users = new Map<string, z.infer<typeof userSchema>>();
  for (const u of rawUsers) {
    const p = userSchema.safeParse(u);
    if (p.success) users.set(p.data.id, p.data);
  }
  const posts: XBuzzPost[] = [];
  for (const t of rawTweets) {
    const p = tweetSchema.safeParse(t);
    if (!p.success) continue;
    const u = users.get(p.data.author_id);
    if (!u) continue;
    const m = { likes: p.data.public_metrics.like_count, reposts: p.data.public_metrics.retweet_count, quotes: p.data.public_metrics.quote_count, replies: p.data.public_metrics.reply_count };
    posts.push({
      id: p.data.id,
      url: `https://x.com/${u.username}/status/${p.data.id}`,
      text: decodeEntities(p.data.note_tweet?.text ?? p.data.text),
      createdAt: p.data.created_at,
      ...m,
      author: { name: u.name, username: u.username, profileUrl: `https://x.com/${u.username}`, imageUrl: safeImageUrl(u.profile_image_url) },
      score: xBuzzScore(m),
    });
  }
  posts.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
  return { posts, postCount: Math.min(rawTweets.length, X_SEARCH_MAX_RESULTS), userCount: Math.min(rawUsers.length, X_SEARCH_MAX_RESULTS) };
}

// 実際の額（返ってきた投稿の数と書いた人の数。同じ日（UTC）に同じものを読むと X は数えないが、ここでは多めに数える）
export function xSearchCostUsd(postCount: number, userCount: number): number {
  return Math.round((postCount * X_PRICE_USD.x_search_read + userCount * X_PRICE_USD.x_search_user_read) * 1e6) / 1e6;
}

// 残りの回数（画面に出す）。reason は DB の x_search_quota の status と、鍵がないときの not_ready
export type XSearchQuota = {
  remaining: number;
  limit: number;
  reason: "ok" | "user_limit" | "new_user_limit" | "global_limit" | "new_global_limit" | "not_ready";
  resetsOn: string | null;
};

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

// 押せないときの文。B（X の画面で探す）は、どのときも使える
export function xSearchQuotaText(q: XSearchQuota): string {
  switch (q.reason) {
    case "ok":
      return `今月はあと ${q.remaining} 回探せます`;
    case "new_user_limit":
      return q.resetsOn ? `登録して 7 日までは月 1 回です（${md(q.resetsOn)} から月 3 回）` : "登録して 7 日までは月 1 回です";
    case "user_limit":
      return q.resetsOn ? `今月の分は使い切りました（${md(q.resetsOn)} から 3 回）` : "今月の分は使い切りました";
    case "global_limit":
      return q.resetsOn ? `yabumi 全体の今月の分は使い切りました（${md(q.resetsOn)} から）` : "yabumi 全体の今月の分は使い切りました";
    case "new_global_limit":
      return q.resetsOn ? `登録して 7 日までの方が探せる今月の分は、いっぱいになりました（${md(q.resetsOn)} から探せます）` : "登録して 7 日までの方が探せる今月の分は、いっぱいになりました";
    case "not_ready":
      return "yabumi の中で探すのは準備中です";
  }
}
