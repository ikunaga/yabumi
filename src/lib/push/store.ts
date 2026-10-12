import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { MAX_DEVICES_PER_USER, TEST_PUSH_INTERVAL_SECONDS, isAllowedEndpoint } from "./rules";
import { type PushResult, type PushSender, sendPush } from "./send";

// 通知を受け取る端末の登録・外す・試しに送る（docs/architecture.md の 4.28）。
// user: 利用者の権限（RLS で本人の端末だけ）。admin: 登録の書き込み（同じ端末で別の利用者が登録し直したら、宛先をその人に移すため）

type Db = SupabaseClient<Database>;
export type PushOutcome<T = object> = ({ ok: true } & T) | { ok: false; message: string };

// ブラウザの PushSubscription.toJSON() の形。鍵は base64url（p256dh は 65 バイト、auth は 16 バイト）
const b64url = /^[A-Za-z0-9_-]+={0,2}$/;
export const subscriptionSchema = z.object({
  endpoint: z.string().max(1000),
  keys: z.object({ p256dh: z.string().min(80).max(100).regex(b64url), auth: z.string().min(16).max(30).regex(b64url) }),
});
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;

export type PushDevice = { id: string; label: string; createdAt: string; lastSuccessAt: string | null };

// この端末を登録する。同じ宛先がすでにあれば（ほかの利用者の分でも）、この利用者のものとして登録し直す。
// 端末が多すぎるときは、古いものから外す
export async function registerDevice(admin: Db, userId: string, sub: SubscriptionInput, label: string): Promise<PushOutcome<{ id: string }>> {
  if (!isAllowedEndpoint(sub.endpoint)) return { ok: false, message: "このブラウザの通知には対応していません。ほかのブラウザでお試しください。" };
  const { data, error } = await admin
    .from("push_subscriptions")
    .upsert(
      { user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, device_label: label.slice(0, 60), created_at: new Date().toISOString(), last_success_at: null, test_sent_at: null },
      { onConflict: "endpoint" },
    )
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "登録できませんでした。時間をおいてもう一度お試しください。" };

  const { data: all } = await admin.from("push_subscriptions").select("id").eq("user_id", userId).order("created_at", { ascending: false });
  const extra = (all ?? []).slice(MAX_DEVICES_PER_USER).map((r) => r.id);
  if (extra.length) await admin.from("push_subscriptions").delete().in("id", extra);
  return { ok: true, id: data.id };
}

// 本人の端末の一覧（新しい順）
export async function listDevices(user: Db): Promise<PushDevice[]> {
  const { data, error } = await user.from("push_subscriptions").select("id, device_label, created_at, last_success_at").order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((r) => ({ id: r.id, label: r.device_label || "この端末", createdAt: r.created_at, lastSuccessAt: r.last_success_at }));
}

// 宛先の URL から、本人の端末の id を探す（この端末が登録されているか）
export async function deviceIdOf(user: Db, endpoint: string): Promise<string | null> {
  const { data } = await user.from("push_subscriptions").select("id").eq("endpoint", endpoint).maybeSingle();
  return data?.id ?? null;
}

// 端末を外す（RLS で本人のものだけ）
export async function removeDevice(user: Db, id: string): Promise<PushOutcome> {
  const { data, error } = await user.from("push_subscriptions").delete().eq("id", id).select("id");
  if (error) return { ok: false, message: "外せませんでした。時間をおいてもう一度お試しください。" };
  if (!data.length) return { ok: false, message: "端末が見つかりません。画面を読み込み直してください。" };
  return { ok: true };
}

// 宛先の URL で外す（ブラウザの側で購読が新しくなったとき）。本人のものだけ
export async function removeDeviceByEndpoint(admin: Db, userId: string, endpoint: string) {
  await admin.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
}

// ログアウトしたら、この端末に送らない（ほかの人が同じ端末を使っても、前の人への通知が出ないように）
export async function removeDeviceOnLogout(admin: Db, userId: string, id: string) {
  await admin.from("push_subscriptions").delete().eq("user_id", userId).eq("id", id);
}

// 「試しに送る」。本人の端末 1 つに送る。続けて押せないように 30 秒あける
export async function sendTestPush(admin: Db, userId: string, id: string, deps: { sender?: PushSender; env?: Record<string, string | undefined> } = {}): Promise<PushOutcome<{ result: PushResult }>> {
  const { data: row } = await admin.from("push_subscriptions").select("id, test_sent_at").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!row) return { ok: false, message: "この端末は登録されていません。もう一度「この端末で通知を受け取る」を押してください。" };
  if (row.test_sent_at && Date.now() - new Date(row.test_sent_at).getTime() < TEST_PUSH_INTERVAL_SECONDS * 1000) {
    return { ok: false, message: `続けて送れません。${TEST_PUSH_INTERVAL_SECONDS} 秒ほどおいてから押してください。` };
  }
  await admin.from("push_subscriptions").update({ test_sent_at: new Date().toISOString() }).eq("id", id);
  const result = await sendPush(admin, userId, { title: "矢書からのお知らせ", body: "この端末で通知を受け取れます。押すと矢書が開きます。", url: "/projects", tag: "test" }, { ...deps, onlyIds: [id] });
  if (result.sent) return { ok: true, result };
  if (result.removed) return { ok: false, message: "この端末には届けられなくなっていました。もう一度「この端末で通知を受け取る」を押してください。" };
  return { ok: false, message: "送れませんでした。時間をおいてもう一度お試しください。" };
}
