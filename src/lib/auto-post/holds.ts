import type { SupabaseClient } from "@supabase/supabase-js";
import { LEGAL, orPending } from "@/lib/legal/info";
import type { PushMessage } from "@/lib/push/send";
import type { Database } from "@/lib/supabase/database.types";

// 運営者が利用者ごとに自動の投稿を止める（docs/design/auto-post.md の「運営者が止める」。20261118100000_auto_post_holds）。
// 断るのは DB の関数が本体（hint auto_post_hold）。ここは、画面に出す文と、ジョブが止めている人を先に外すためのもの

type Db = SupabaseClient<Database>;

// 画面と通知に出す文。理由は出さない（運営者のメモは、調べている途中のことや、ほかの人のことを含みうるため。理由は運営者がメールで伝える）
export const HOLD_TITLE = "運営者が、自動の投稿を止めています";
export function holdBody(heldAt: string): string {
  const d = new Date(new Date(heldAt).getTime() + 9 * 3_600_000);
  const date = `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  return `${date}から、あなたのアカウントの自動の投稿を止めています。新しく作る・再開する・送ることはできません。問い合わせ先: ${orPending(LEGAL.contact)}`;
}
// DB が断ったときの文（actions.ts の HINT_TEXT）
export const HOLD_REFUSED = `運営者が、あなたのアカウントの自動の投稿を止めています。新しく作る・再開する・送ることはできません。問い合わせ先: ${orPending(LEGAL.contact)}`;

export const HOLD_PUSH: Omit<PushMessage, "url" | "tag"> = {
  title: "自動の投稿を止めました",
  body: "運営者が、あなたのアカウントの自動の投稿を止めました。くわしくは問い合わせ先へ",
};
export const RELEASE_PUSH: Omit<PushMessage, "url" | "tag"> = {
  title: "自動の投稿を再開できます",
  body: "運営者が止めていた自動の投稿を、また使えるようにしました。最初の回は確かめてから送ります",
};

// 本人が、いま止められているか（利用者の権限。RLS で本人の行だけ、列は日時だけ読める）。止められていなければ null
export async function myAutoPostHold(db: Db): Promise<{ heldAt: string } | null> {
  const { data, error } = await db.from("auto_post_holds").select("held_at").is("released_at", null).maybeSingle();
  if (error) throw error;
  return data ? { heldAt: data.held_at } : null;
}

// いま止めている人（サーバーの権限）。ownerIds を渡すと、その人たちのうちで
export async function heldUserIds(admin: Db, ownerIds?: string[]): Promise<Set<string>> {
  let q = admin.from("auto_post_holds").select("user_id").is("released_at", null);
  if (ownerIds) q = q.in("user_id", ownerIds);
  const { data, error } = await q;
  if (error) throw error;
  return new Set(data.map((r) => r.user_id));
}

// 1 人がいま止められているか（サーバーの権限）
export async function isAutoPostHeld(admin: Db, userId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("auto_post_held", { p_uid: userId });
  if (error) throw error;
  return data === true;
}

// ===== 運営者の操作（/admin/auto-holds と docs/deploy.md の 32。サーバーの権限で、DB の operator_* の関数を呼ぶ） =====

export type HoldRow = { id: string; email: string; reason: string; heldBy: string; heldAt: string };
export type OperatorResult = { ok: true; notice: string } | { ok: false; error: string };

// いま止めている人（新しい順）
export async function listAutoPostHolds(admin: Db): Promise<HoldRow[]> {
  const { data, error } = await admin.rpc("operator_auto_post_holds");
  if (error) throw error;
  return data.map((r) => ({ id: r.hold_id, email: r.email, reason: r.reason, heldBy: r.held_by, heldAt: r.held_at }));
}

function operatorError(e: { code?: string; message: string }): string {
  if (e.code === "P0002") return "このメールアドレスの利用者は見つかりません。";
  if (e.code === "22023") return "理由は 1〜200 字で入れてください。";
  console.error("[auto-post-hold]", e.code, e.message);
  return "うまくいきませんでした。時間をおいてもう一度お試しください。";
}

// 止める。まだ送っていない自動の回を取り消し、作り終えた投稿は下書きに戻す（DB の関数の中で）
export async function holdAutoPost(admin: Db, args: { email: string; reason: string; by: string }): Promise<OperatorResult> {
  const { data, error } = await admin.rpc("operator_hold_auto_post", { p_email: args.email, p_reason: args.reason, p_by: args.by });
  if (error) return { ok: false, error: operatorError(error) };
  const r = data[0];
  if (r.already_held) return { ok: true, notice: "すでに止めています（前の理由のまま）。" };
  return {
    ok: true,
    notice: r.canceled_runs > 0 ? `止めました。まだ送っていない自動の回を ${r.canceled_runs} 件取り消し、作り終えた投稿は下書きに戻しました。` : "止めました。まだ送っていない回はありませんでした。",
  };
}

// 解除する。動いている回し方は、最初の回をまた確かめてもらう（DB の関数の中で）
export async function releaseAutoPost(admin: Db, args: { email: string; reason: string; by: string }): Promise<OperatorResult> {
  const { data, error } = await admin.rpc("operator_release_auto_post", { p_email: args.email, p_reason: args.reason, p_by: args.by });
  if (error) return { ok: false, error: operatorError(error) };
  return data[0].released ? { ok: true, notice: "解除しました。動いている自動の投稿は、最初の回を確かめてから送ります。" } : { ok: false, error: "この利用者は止めていません。" };
}
