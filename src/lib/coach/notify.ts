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

// 設定で選ぶ種類（遅れそう・毎週の振り返り）。予定日を過ぎたやること（overdue）は「遅れそうなとき」に含める
export type CoachKind = "behind" | "weekly";
// 送った記録の種類（overdue は、やることごとに 1 回だけ）
export type LogKind = CoachKind | "overdue";
export type Claim = { kind: LogKind; periodKey: string };
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

// 記録を入れる。新しく入った行の ID（すでにあったものは入らない）
async function claim(admin: Db, base: { user_id: string; project_id: string }, claims: Claim[], channel: "email" | "push"): Promise<number[]> {
  const rows = claims.map((c) => ({ ...base, kind: c.kind, period_key: c.periodKey, channel }));
  const { data, error } = await admin.from("notification_log").upsert(rows, { onConflict: "user_id,project_id,kind,period_key,channel", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

// まだ送っていない、予定日を過ぎたやること（どの経路でも送っていないもの）
export async function unsentOverdue(admin: Db, userId: string, projectId: string, itemIds: string[]): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await admin.from("notification_log").select("period_key").eq("user_id", userId).eq("project_id", projectId).eq("kind", "overdue").in("period_key", itemIds);
  if (error) throw error;
  const sent = new Set((data ?? []).map((r) => r.period_key));
  return itemIds.filter((id) => !sent.has(id));
}

export async function deliverCoachMessage(
  admin: Db,
  // kind: 設定のどの種類として送るか。claims: 入れる記録（ふつうは kind とその週。予定日を過ぎたやることは、やることごとに）。
  // どれか 1 つでも新しく入れば送る（すべてすでにあれば dup）
  args: { userId: string; email: string | null; projectId: string; kind: CoachKind; claims: Claim[]; prefs: Prefs; message: CoachMessage; headers?: Record<string, string> },
  deps: DeliverDeps = {},
): Promise<DeliverResult> {
  const base = { user_id: args.userId, project_id: args.projectId };
  const result: DeliverResult = { email: "off", push: "off" };

  if (wants(args.prefs.email_mode, args.kind) && args.email) {
    const ids = await claim(admin, base, args.claims, "email");
    if (ids.length === 0) result.email = "dup";
    else {
      result.email = await sendUserMail({ to: args.email, ...args.message.email, headers: args.headers }, deps.mail);
      // 送れなかったら記録を消し、次の回（翌日のジョブ）にまた送れるようにする
      if (result.email !== "sent") await admin.from("notification_log").delete().in("id", ids);
    }
  }

  if (wants(args.prefs.push_mode, args.kind)) {
    const ids = await claim(admin, base, args.claims, "push");
    if (ids.length === 0) result.push = "dup";
    else {
      const r = await (deps.push ?? sendPush)(admin, args.userId, args.message.push);
      result.push = r.sent > 0 ? "sent" : "none";
      if (r.sent === 0) await admin.from("notification_log").delete().in("id", ids);
    }
  }
  return result;
}
