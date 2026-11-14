import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPush, type PushMessage, type PushResult } from "@/lib/push/send";
import { SNS, isSnsKey, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";

// コメントのまとめの通知（docs/design/sns-comments.md の 5、docs/architecture.md の 4.70）。毎日 19:00（日本時間）に 1 回。
// まだ知らせていない・まだ見ていない・自分のものでないコメントの件数だけを、スマホに送る（メールは送らない。オーナーの決定）。
// コメントの本文と書いた人の名前は入れない（push のサービスとロック画面に、他の人の文を出さない）

type Admin = SupabaseClient<Database>;

export type DigestDeps = {
  push?: (admin: Admin, userId: string, msg: PushMessage) => Promise<PushResult>;
  now?: () => Date;
  // テストの利用者だけに絞る
  ownerId?: string;
  limit?: number;
};

export type DigestGroup = { projectId: string; projectName: string; bySns: Partial<Record<SnsKey, number>>; total: number };

type Row = { id: string; owner_id: string; sns: string; post_targets: { posts: { project_id: string; projects: { name: string } | null } | null } | null };

// 利用者 1 人分の通知の中身（いちばん多いプロジェクトを開く）
export function digestMessage(groups: DigestGroup[]): PushMessage | null {
  const sorted = [...groups].sort((a, b) => b.total - a.total);
  const top = sorted[0];
  if (!top) return null;
  const total = groups.reduce((n, g) => n + g.total, 0);
  const parts = (Object.entries(top.bySns) as [SnsKey, number][]).map(([s, n]) => `${SNS[s].label} ${n}`).join("・");
  const others = sorted.length - 1;
  return {
    title: `新しいコメント ${total} 件`,
    body: `${top.projectName}: ${parts}${others > 0 ? `（ほか ${others} つのプロジェクト）` : ""}`,
    url: `/projects/${top.projectId}/comments`,
    tag: "comments",
  };
}

export async function runCommentDigest(admin: Admin, deps: DigestDeps = {}) {
  const now = deps.now?.() ?? new Date();
  let q = admin
    .from("sns_comments")
    .select("id, owner_id, sns, post_targets!inner(posts!inner(project_id, projects!inner(name)))")
    .is("notified_at", null)
    .is("seen_at", null)
    .eq("is_own", false)
    .limit(deps.limit ?? 5000);
  if (deps.ownerId) q = q.eq("owner_id", deps.ownerId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];

  // 利用者 → プロジェクト → SNS ごとの件数
  const byOwner = new Map<string, { ids: string[]; groups: Map<string, DigestGroup> }>();
  for (const r of rows) {
    const post = r.post_targets?.posts;
    if (!post || !isSnsKey(r.sns)) continue;
    const o = byOwner.get(r.owner_id) ?? { ids: [] as string[], groups: new Map<string, DigestGroup>() };
    o.ids.push(r.id);
    const g = o.groups.get(post.project_id) ?? { projectId: post.project_id, projectName: post.projects?.name ?? "", bySns: {}, total: 0 };
    g.bySns[r.sns] = (g.bySns[r.sns] ?? 0) + 1;
    g.total++;
    o.groups.set(post.project_id, g);
    byOwner.set(r.owner_id, o);
  }
  if (!byOwner.size) return [];

  const { data: prefs, error: e2 } = await admin.from("notification_prefs").select("user_id, comment_push").in("user_id", [...byOwner.keys()]);
  if (e2) throw e2;
  const off = new Set((prefs ?? []).filter((p) => p.comment_push === "off").map((p) => p.user_id));

  const outcomes: { userId: string; result: "sent" | "off" | "no_device" | "failed"; total: number }[] = [];
  for (const [userId, o] of byOwner) {
    const total = o.ids.length;
    let result: (typeof outcomes)[number]["result"] = "off";
    if (!off.has(userId)) {
      const msg = digestMessage([...o.groups.values()]);
      try {
        const r = msg ? await (deps.push ?? sendPush)(admin, userId, msg) : { sent: 0, removed: 0, failed: 0 };
        result = r.sent > 0 ? "sent" : r.failed > 0 ? "failed" : "no_device";
      } catch {
        result = "failed";
      }
    }
    // 送れなかったとき（push サービスの失敗）だけ、明日もう一度知らせる。受け取らない・端末がないときは知らせたことにする（あとで溜まった分が一度に来ないように）
    if (result !== "failed") {
      const { error: e3 } = await admin.from("sns_comments").update({ notified_at: now.toISOString() }).in("id", o.ids);
      if (e3) throw e3;
    }
    outcomes.push({ userId, result, total });
  }
  return outcomes;
}
