import type { PlanData } from "@/lib/plan/schema";

// 「X で人気の投稿から」ネタを出す材料（オーナーと決めた B 案。docs/architecture.md の 4.52）。
// 探すのは X の画面で（費用 0）、利用者が気になった投稿の URL と、写した文を yabumi に貼る。投稿の中身は API で読まない。
// 画面（idea-board）とサーバー（post-ideas）の両方から読むので、サーバー専用のものを import しない

// 貼られた文（投稿の文を写したもの）と、どこが気になったかの答えの上限
export const MAX_X_POST_TEXT = 1000;
export const MAX_X_POST_INTEREST = 300;

// yabumi の中で探す（A 案、x-buzz-search.tsx）で選んだ投稿を、URL と文の欄に入れる形
export type XPostPick = { url: string; text: string };

export type XPostRef = { id: string; url: string };

const X_HOSTS = new Set(["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);
// /<ユーザー名>/status/<数字> と、ユーザー名のない /i/web/status/<数字>・/i/status/<数字>。数字は投稿の id（64 ビットなので 19 桁まで）
const STATUS_PATH = /^\/(?:([A-Za-z0-9_]{1,15})|i|i\/web)\/status(?:es)?\/(\d{1,19})(?:\/(?:photo|video)\/\d+|\/)?$/;

// X の投稿の URL から id を取り出す。x.com・twitter.com の投稿の URL だけを受け付け、ほかは null。
// 返す URL は x.com の形にそろえ、追いかけ用の ?s=20 などは落とす
export function parseXPostUrl(raw: string): XPostRef | null {
  const s = raw.trim();
  if (!s || s.length > 500) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  if (!X_HOSTS.has(url.hostname.toLowerCase())) return null;
  const m = STATUS_PATH.exec(url.pathname);
  if (!m) return null;
  const id = m[2].replace(/^0+(?=\d)/, "");
  if (id === "0") return null;
  const user = m[1] && !["i", "home", "search", "explore"].includes(m[1].toLowerCase()) ? m[1] : null;
  return { id, url: user ? `https://x.com/${user}/status/${id}` : `https://x.com/i/web/status/${id}` };
}

// ===== 検索の言葉（AI は使わず、アカウント設計から決まった組み立て方で作る） =====

export const X_SEARCH_WORDS_MAX = 5;
export const X_SEARCH_WORD_MAX_CHARS = 40;
// 人気で絞る「いいね」の数（min_faves）。小さい分野では 50 だと出ないことがあるので選べる
export const X_MIN_FAVES_OPTIONS = [10, 50, 100, 500] as const;
export type XMinFaves = (typeof X_MIN_FAVES_OPTIONS)[number];
export const X_DEFAULT_MIN_FAVES: XMinFaves = 50;

// 検索の演算子として読まれる記号（from: や "..."、先頭の - など）を消して、言葉だけにする
export function cleanSearchWord(raw: string): string {
  return raw
    .replace(/[:"()（）「」『』]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—]+/, "")
    .trim()
    .slice(0, X_SEARCH_WORD_MAX_CHARS)
    .trim();
}

// 文を区切って、検索に使える短い言葉（2〜15 字）を取り出す
function phrases(text: string): string[] {
  return text
    .split(/[、。,，.．!！?？\n\r\t 　・／/「」『』（）()【】…~〜]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.length <= 15 && !/^https?$/i.test(p) && !/^\d+$/.test(p));
}

export type XSearchSource = { project: { description: string; targetAudience: string }; plan: PlanData };

// 検索の言葉を 3〜5 個作る。順に: ハッシュタグ（2 つまで）→ 投稿の柱の名前（2 つまで）→ コンセプト・届けたい相手の言葉。
// 設計が空なら、プロジェクトの説明から作る。同じ言葉は 1 つにする
export function xSearchWords(src: XSearchSource): string[] {
  const { project, plan } = src;
  const out: string[] = [];
  const add = (w: string) => {
    const c = cleanSearchWord(w);
    if (c.length < 2 || out.length >= X_SEARCH_WORDS_MAX) return;
    if (out.some((x) => x.toLowerCase() === c.toLowerCase())) return;
    out.push(c);
  };
  for (const h of plan.hashtags.items.slice(0, 2)) if (h.tag.trim()) add(`#${h.tag.trim().replace(/^#/, "")}`);
  for (const p of plan.pillars.items.filter((i) => i.name.trim() && i.name.trim().length <= 15).slice(0, 2)) add(p.name);
  const rest = [plan.concept.statement, plan.audience.who || project.targetAudience, plan.audience.pain, plan.goal.what];
  for (const t of rest) for (const p of phrases(t).slice(0, 2)) add(p);
  // 設計から 3 つに満たなければ、説明から足す
  if (out.length < 3) for (const p of phrases(project.description)) add(p);
  return out;
}

// X の検索の画面（人気の順）の URL。言葉に、人気で絞る条件と日本語だけ・返信を除くを付ける（Web の検索の書き方）
export function xSearchQuery(word: string, minFaves: number): string {
  const w = cleanSearchWord(word);
  return `${w} min_faves:${Math.max(1, Math.floor(minFaves))} lang:ja -filter:replies`;
}

export function xSearchUrl(word: string, minFaves: number): string {
  return `https://x.com/search?q=${encodeURIComponent(xSearchQuery(word, minFaves))}&src=typed_query&f=top`;
}

// 文を貼らなかったときに聞く 1 問（URL だけでは中身がわからないため）。答えの例を押すか、自分の言葉で答える
export const X_POST_INTEREST_QUESTION = "この投稿のどこが気になりましたか";
export const X_POST_INTEREST_CHOICES = ["書き出しの一言", "話題の選び方", "言い回し・口調", "問いかけ方", "反応が多い理由"];
