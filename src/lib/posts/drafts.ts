import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// 下書き（まだどこにも送っていない投稿）の決め方と、一覧の 1 行の題（2026-11-13 PMO2 の確かめ: 保存した下書きへたどる入口がなかった）。
// 下書き = 予約していない（status が draft）で、送り先がどれもまだ送り始めていない（pending・awaiting_approval）もの。今すぐ送った投稿は draft のまま送られるので、
// 送り先の状態も見る（概要の「下書き n 件」・カレンダーの「下書き」・下書きの一覧・投稿をつくるの「下書きから続ける」で同じ）

type Db = SupabaseClient<Database>;

// まだ送り始めていない配信先の状態。pending（送る前）と awaiting_approval（確認して送る SNS の、確認待ち）。
// 自動投稿が下書きに回した投稿は、X などが awaiting_approval のまま残るので、これも「まだ送っていない」に入れる
// （前は pending だけを見ていて、下書きの数にも一覧にも入らなかった。2026-11-23 本番）
export const UNSENT_TARGET_STATUSES = ["pending", "awaiting_approval"] as const;

export function isUnsentDraft(p: { status: string; targetStatuses: readonly string[] }): boolean {
  return p.status === "draft" && p.targetStatuses.every((s) => (UNSENT_TARGET_STATUSES as readonly string[]).includes(s));
}

// 下書きの数（行を読まずに DB で数える。draft の投稿の数から、送り始めた配信先〈pending・awaiting_approval 以外〉が 1 つでもあるものを引く）
export async function countUnsentDrafts(db: Db, projectId: string): Promise<number> {
  const head = { count: "exact", head: true } as const;
  const [all, sent] = await Promise.all([
    db.from("posts").select("id", head).eq("project_id", projectId).eq("status", "draft"),
    db.from("posts").select("id, post_targets!inner(id)", head).eq("project_id", projectId).eq("status", "draft").not("post_targets.status", "in", `(${UNSENT_TARGET_STATUSES.join(",")})`),
  ]);
  if (all.error) throw all.error;
  if (sent.error) throw sent.error;
  return Math.max(0, (all.count ?? 0) - (sent.count ?? 0));
}

// 一覧の 1 行の題: 本文を 1 行にまとめたもの（長ければ画面で 2 行まで出して「…」）。本文が空なら、SNS ごとの文面・題、なければ画像の枚数
export function draftHeadline(p: { body: string; overrides: readonly (string | null)[]; titles: readonly (string | null)[]; images: number }): { text: string; empty: boolean } {
  const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
  const body = oneLine(p.body);
  if (body) return { text: body, empty: false };
  const other = [...p.overrides, ...p.titles].map((s) => oneLine(s ?? "")).find(Boolean);
  if (other) return { text: other, empty: false };
  return { text: p.images > 0 ? `画像 ${p.images} 枚・本文なし` : "本文なし", empty: true };
}
