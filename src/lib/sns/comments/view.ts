import type { SnsKey } from "@/lib/sns";

// コメントの画面に出す形（docs/design/sns-comments.md の 6）。DB を読まない、組み立てだけ（テストする）

export type CommentRowIn = {
  id: string;
  post_target_id: string;
  sns: string;
  parent_external_id: string | null;
  author_name: string;
  body: string;
  is_own: boolean;
  commented_at: string;
  seen_at: string | null;
};

export type TargetIn = {
  id: string;
  postId: string;
  sns: SnsKey;
  title: string;
  publishedAt: string;
  url: string | null;
  // 毎日の数字の取り込みの最新（なければ null）
  likes: number | null;
  replies: number | null;
};

export type CommentView = {
  id: string;
  authorName: string;
  body: string;
  isOwn: boolean;
  isNew: boolean;
  isReply: boolean;
  commentedAt: string;
};

export type PostCommentsView = {
  targetId: string;
  postId: string;
  sns: SnsKey;
  title: string;
  publishedAt: string;
  url: string | null;
  likes: number | null;
  // 数: yabumi が読んだコメントの数（自分のものを除く）。X は毎日の数字の返信の数
  count: number;
  newCount: number;
  comments: CommentView[];
};

// 見てから 10 分は「● 新しい」の印を残す（同じ画面のほかの処理が画面を読み直しても、表示したその回の印が消えないように。
// 概要の帯は、まだ見ていないもの（seen_at が空）だけを数える）
export const SEEN_GRACE_MS = 10 * 60_000;
const isUnseen = (c: Pick<CommentRowIn, "is_own" | "seen_at">) => !c.is_own && c.seen_at === null;
const isNewAt = (now: Date) => (c: Pick<CommentRowIn, "is_own" | "seen_at">) =>
  !c.is_own && (c.seen_at === null || now.getTime() - new Date(c.seen_at).getTime() < SEEN_GRACE_MS);

// 古い順に並べる。返信への返信は字下げで見分ける（親は先に書かれているので、ふつうは親の後ろに来る。
// SNS のコメントの ID は画面に出さない列なので、親の真下へ並べ替えることはしない）
const ordered = (rows: CommentRowIn[]) => [...rows].sort((a, b) => a.commented_at.localeCompare(b.commented_at));

export function buildPostComments(targets: TargetIn[], rows: CommentRowIn[], now: Date = new Date()): PostCommentsView[] {
  const isNew = isNewAt(now);
  const byTarget = new Map<string, CommentRowIn[]>();
  for (const r of rows) {
    const list = byTarget.get(r.post_target_id) ?? [];
    list.push(r);
    byTarget.set(r.post_target_id, list);
  }
  const views: PostCommentsView[] = [];
  for (const t of targets) {
    if (t.sns === "x") {
      // X は中身を読まない。返信の数があるものだけ出す
      if (!t.replies) continue;
      views.push({ targetId: t.id, postId: t.postId, sns: t.sns, title: t.title, publishedAt: t.publishedAt, url: t.url, likes: t.likes, count: t.replies, newCount: 0, comments: [] });
      continue;
    }
    const list = byTarget.get(t.id) ?? [];
    if (!list.length) continue;
    views.push({
      targetId: t.id,
      postId: t.postId,
      sns: t.sns,
      title: t.title,
      publishedAt: t.publishedAt,
      url: t.url,
      likes: t.likes,
      count: list.filter((c) => !c.is_own).length,
      newCount: list.filter(isNew).length,
      comments: ordered(list).map((c) => ({
        id: c.id,
        authorName: c.author_name,
        body: c.body,
        isOwn: c.is_own,
        isNew: isNew(c),
        isReply: Boolean(c.parent_external_id),
        commentedAt: c.commented_at,
      })),
    });
  }
  // 新しいコメントのある投稿が上、あとは送った日の新しい順
  return views.sort((a, b) => Number(b.newCount > 0) - Number(a.newCount > 0) || b.publishedAt.localeCompare(a.publishedAt));
}

// 新しいコメントの数（概要の帯）。SNS ごとの内訳つき
export function newCommentSummary(rows: Pick<CommentRowIn, "sns" | "is_own" | "seen_at">[]): { total: number; bySns: Partial<Record<SnsKey, number>> } {
  const bySns: Partial<Record<SnsKey, number>> = {};
  let total = 0;
  for (const r of rows) {
    if (!isUnseen(r)) continue;
    total++;
    bySns[r.sns as SnsKey] = (bySns[r.sns as SnsKey] ?? 0) + 1;
  }
  return { total, bySns };
}

// 「2 時間前」「昨日」「11/12」
export function agoLabel(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min} 分前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 時間前`;
  if (hours < 48) return "昨日";
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).formatToParts(d);
  return `${p.find((x) => x.type === "month")?.value}/${p.find((x) => x.type === "day")?.value}`;
}
