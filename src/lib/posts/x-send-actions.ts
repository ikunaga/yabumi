"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { xConfigured } from "@/lib/sns/x/config";
import { xSendVerdict, type XSendVerdict } from "@/lib/sns/x/send-verdict";
import { fromInputValue } from "@/lib/time";

// 投稿をつくるの ② と ⑤ で、X をいま（予約ならその時刻に）送ったら月の上限に当たるかを、送信ジョブと同じ判定で返す。
// 額そのものは返さない（全体の上限は、ほかの人の額が見えないよう、達するかどうかだけ）
const input = z.object({
  projectId: z.uuid(),
  text: z.string().max(20000),
  altCount: z.number().int().min(0).max(10),
  // 日本時間の "YYYY-MM-DDTHH:mm"。空ならいま
  plannedAt: z.string().max(40).default(""),
});

// now: 今すぐ送るとき。planned: 予約の日時に送るとき（日時がなければ null。来月以降なら、その月の額は 0 から）
export async function checkXSend(raw: unknown): Promise<{ now: XSendVerdict; planned: XSendVerdict | null } | null> {
  const p = input.safeParse(raw);
  if (!p.success || !xConfigured()) return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  // 本人のプロジェクトのときだけ（RLS で本人のものしか読めない）
  const { data: project } = await supabase.from("projects").select("id").eq("id", p.data.projectId).maybeSingle();
  if (!project) return null;
  const at = p.data.plannedAt ? fromInputValue(p.data.plannedAt) : null;
  const admin = createAdminClient();
  const a = { text: p.data.text, altCount: p.data.altCount };
  const [now, planned] = await Promise.all([xSendVerdict(admin, userId, a), at ? xSendVerdict(admin, userId, { ...a, at: new Date(at) }) : Promise.resolve(null)]);
  return { now, planned };
}
