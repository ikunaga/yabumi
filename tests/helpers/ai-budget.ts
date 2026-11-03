// 文章の AI の上限（DB の関数 reserve_ai_usage。上限は関数の中で固定）を、結合テストで使うときの手伝い
import { setAiBudgetTestScope } from "@/lib/ai/budget";
import type { adminClient } from "./supabase";

// 全体の合計を本人の分だけで数え（共有のローカル DB のほかのテストに左右されない）、登録して 7 日を過ぎた人として数える（普段の枠）
export function scopeAiBudget() {
  setAiBudgetTestScope({ scopeSelf: true, asOf: new Date("2100-01-01T00:00:00Z") });
}

// 本人の今月の利用を usd だけ足す（上限に届いたときを試す）。消すときは返した id で
export async function spendAi(admin: ReturnType<typeof adminClient>, userId: string, usd: number, count = 1): Promise<string[]> {
  const rows = Array.from({ length: count }, () => ({ owner_id: userId, purpose: "test_fill", model: "test", cost_usd: usd / count }));
  const { data, error } = await admin.from("ai_usage").insert(rows).select("id");
  if (error) throw error;
  return data.map((r) => r.id);
}

export async function unspendAi(admin: ReturnType<typeof adminClient>, ids: string[]) {
  if (ids.length) await admin.from("ai_usage").delete().in("id", ids);
}
