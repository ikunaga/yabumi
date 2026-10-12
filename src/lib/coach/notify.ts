import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendUserMail, type UserMailDeps } from "@/lib/notify/user-mail";
import { sendPush, type PushMessage, type PushResult } from "@/lib/push/send";
import type { Database } from "@/lib/supabase/database.types";
import type { CoachMessage } from "./messages";

// 伴走の知らせを配る共通の部品（4.27）: 「誰に（userId）・何を（kind と中身）・どの経路で（メール・スマホの通知）」を決めて送る。
// 送るかどうか（通知の設定）はここで確かめ、同じ知らせ（利用者・プロジェクト・種類・週・経路）は notification_log で 1 回だけにする。
// 画面の声かけは、同じ計算（pace.ts）から毎回出すので、ここを通らない
type Db = SupabaseClient<Database>;

export type CoachKind = "behind" | "weekly";
export type NotifyMode = "weekly_and_behind" | "weekly" | "off";
export type Prefs = { email_mode: NotifyMode; push_mode: NotifyMode; behind_weekday: number; unsubscribe_token: string };


export function wants(mode: NotifyMode, kind: CoachKind): boolean {
  return mode === "weekly_and_behind" || (mode === "weekly" && kind === "weekly");
}

// 設定の行がなければ既定で作る（メールの配信の停止の合言葉が要るため）
export async function ensurePrefs(admin: Db, userId: string): Promise<Prefs> {
  const { data } = await admin.from("notification_prefs").select("email_mode, push_mode, behind_weekday, unsubscribe_token").eq("user_id", userId).maybeSingle();
  if (data) return data as Prefs;
  const { data: created, error } = await admin
    .from("notification_prefs")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: false })
    .select("email_mode, push_mode, behind_weekday, unsubscribe_token")
    .single();
  if (error) throw error;
  return created as Prefs;
}

export type DeliverDeps = { mail?: UserMailDeps; push?: (admin: Db, userId: string, msg: PushMessage) => Promise<PushResult> };
export type DeliverResult = { email: "sent" | "skipped" | "failed" | "off" | "dup"; push: "sent" | "none" | "off" | "dup" };

async function claim(admin: Db, row: { user_id: string; project_id: string; kind: CoachKind; period_key: string; channel: "email" | "push" }): Promise<number | null> {
  const { data, error } = await admin.from("notification_log").upsert(row, { onConflict: "user_id,project_id,kind,period_key,channel", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

export async function deliverCoachMessage(
  admin: Db,
  args: { userId: string; email: string | null; projectId: string; kind: CoachKind; periodKey: string; prefs: Prefs; message: CoachMessage; headers?: Record<string, string> },
  deps: DeliverDeps = {},
): Promise<DeliverResult> {
  const base = { user_id: args.userId, project_id: args.projectId, kind: args.kind, period_key: args.periodKey };
  const result: DeliverResult = { email: "off", push: "off" };

  if (wants(args.prefs.email_mode, args.kind) && args.email) {
    const id = await claim(admin, { ...base, channel: "email" });
    if (id === null) result.email = "dup";
    else {
      result.email = await sendUserMail({ to: args.email, ...args.message.email, headers: args.headers }, deps.mail);
      // 送れなかったら記録を消し、次の回（翌日のジョブ）にまた送れるようにする
      if (result.email !== "sent") await admin.from("notification_log").delete().eq("id", id);
    }
  }

  if (wants(args.prefs.push_mode, args.kind)) {
    const id = await claim(admin, { ...base, channel: "push" });
    if (id === null) result.push = "dup";
    else {
      const r = await (deps.push ?? sendPush)(admin, args.userId, args.message.push);
      result.push = r.sent > 0 ? "sent" : "none";
      if (r.sent === 0) await admin.from("notification_log").delete().eq("id", id);
    }
  }
  return result;
}
