"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { appUrl } from "@/lib/sns/threads/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isOperatorEmail } from "@/lib/waitlist/operator";
import { startLegalNotice } from "./notice-mail";

// 運営者の画面（/admin/legal-notice）の「全員に送る」（決定 D31。docs/architecture.md の 4.30）
export async function startLegalNoticeAction(): Promise<{ error?: string; notice?: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  if (!isOperatorEmail(email)) notFound();
  const r = await startLegalNotice(createAdminClient(), { appUrl: appUrl(), deadlineMs: Date.now() + 45_000 });
  revalidatePath("/admin/legal-notice");
  switch (r.reason) {
    case "no_change":
      return { error: "予定の変更がありません。" };
    case "not_noticing":
      return { error: "知らせ始める日の前です。その日から送れます。" };
    case "daily_limit":
    case "deadline":
      return { notice: `${r.sent} 通を送りました（送れなかった ${r.failed} 通）。残りの ${r.remaining} 人には、毎日 9:10 のジョブが続きを送ります。` };
    default:
      return { notice: `${r.sent} 通を送りました（送れなかった ${r.failed} 通）。${r.remaining ? `送れなかった ${r.remaining} 人には、毎日 9:10 のジョブが送り直します。` : "全員に送り終えました。"}` };
  }
}
