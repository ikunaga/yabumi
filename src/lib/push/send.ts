import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush, { WebPushError } from "web-push";
import { envReady } from "@/lib/env-check";
import type { Database } from "@/lib/supabase/database.types";
import { MAX_BODY_CHARS, MAX_TITLE_CHARS, PUSH_TIMEOUT_MS, PUSH_TTL_SECONDS, clip, isAllowedEndpoint, safePath } from "./rules";

// スマホの通知（Web Push）を送る部品（docs/architecture.md の 4.28）。伴走の声かけ（src/lib/coach/notify.ts）から呼ぶ。
// 送るかどうか（設定・回数・時刻）は呼ぶ側が決める。ここは、その利用者が登録したすべての端末に届けるだけ。
// 暗号化（RFC 8291）と VAPID の署名（RFC 8292）は web-push のライブラリに任せる

type Db = SupabaseClient<Database>;

export type PushMessage = {
  // 30 字まで（超えたら「…」で切る）
  title: string;
  // 80 字まで（超えたら「…」で切る）。投稿の本文などの中身は入れない（ロック画面に出る）
  body: string;
  // 押したときに開く矢書の中のパス（「/」で始まるもの。ほかは「/」にする）
  url: string;
  // 同じ tag の通知は新しいもので置き換わる（例 pace:<projectId>）
  tag?: string;
};

export type PushResult = { sent: number; removed: number; failed: number };

// service worker（public/sw.js）が受け取る中身
export type PushPayload = { title: string; body: string; url: string; tag?: string };

const FEATURE = "スマホの通知（Web Push）";
const VAPID_ENV = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

// 画面がブラウザに渡す公開鍵（秘密ではない）。鍵がそろっていなければ null（「準備中」）
export function vapidPublicKey(env: Record<string, string | undefined> = process.env): string | null {
  return envReady(FEATURE, VAPID_ENV, env) ? env.VAPID_PUBLIC_KEY! : null;
}

type Target = { endpoint: string; keys: { p256dh: string; auth: string } };
// テストで差し替える（本物の push サービスに送らない）
export type PushSender = (target: Target, payload: string, options: webpush.RequestOptions) => Promise<unknown>;

const defaultSender: PushSender = (target, payload, options) => webpush.sendNotification(target, payload, options);

export function buildPayload(msg: PushMessage): PushPayload {
  return {
    title: clip(msg.title, MAX_TITLE_CHARS) || "矢書",
    body: clip(msg.body, MAX_BODY_CHARS),
    url: safePath(msg.url),
    ...(msg.tag ? { tag: msg.tag.slice(0, 100) } : {}),
  };
}

// push サービスの Topic（届く前なら、同じ Topic の古いものを置き換える）。URL で使える 32 字まで
export function topicOf(tag: string): string {
  return createHash("sha256").update(tag).digest("base64url").slice(0, 32);
}

function statusOf(e: unknown): number | undefined {
  if (e instanceof WebPushError) return e.statusCode;
  const s = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === "number" ? s : undefined;
}

// その利用者が登録したすべての端末に送る。端末がなければ { sent: 0 }。
// 送れなくなった宛先（404・410）はその場で消す。VAPID の鍵がなければ送らない（ログに出す）
export async function sendPush(
  admin: Db,
  userId: string,
  msg: PushMessage,
  deps: { sender?: PushSender; env?: Record<string, string | undefined>; onlyIds?: string[] } = {},
): Promise<PushResult> {
  const env = deps.env ?? process.env;
  const result: PushResult = { sent: 0, removed: 0, failed: 0 };
  if (!envReady(FEATURE, VAPID_ENV, env)) return result;

  let query = admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (deps.onlyIds) query = query.in("id", deps.onlyIds);
  const { data: subs, error } = await query;
  if (error) throw error;
  if (!subs.length) return result;

  const payload = buildPayload(msg);
  const options: webpush.RequestOptions = {
    vapidDetails: { subject: env.VAPID_SUBJECT!, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! },
    TTL: PUSH_TTL_SECONDS,
    urgency: "normal",
    timeout: PUSH_TIMEOUT_MS,
    ...(payload.tag ? { topic: topicOf(payload.tag) } : {}),
  };
  const send = deps.sender ?? defaultSender;
  const body = JSON.stringify(payload);

  const gone: string[] = [];
  const delivered: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      // 登録のときに確かめているが、送る前にもう一度（許可していないホストには送らない）
      if (!isAllowedEndpoint(s.endpoint)) {
        gone.push(s.id);
        return;
      }
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, options);
        delivered.push(s.id);
      } catch (e) {
        const status = statusOf(e);
        // 404・410: 購読が切れた（ブラウザのデータを消した、通知を切った、など）。もう届かないので消す
        if (status === 404 || status === 410) gone.push(s.id);
        else {
          result.failed += 1;
          // 宛先の URL は端末ごとの ID を含むので、ログにはホストだけを出す
          console.error("[push] 送れませんでした", new URL(s.endpoint).host, status ?? (e instanceof Error ? e.message : String(e)));
        }
      }
    }),
  );

  if (gone.length) {
    const { error: delError } = await admin.from("push_subscriptions").delete().in("id", gone);
    if (delError) console.error("[push] 切れた宛先を消せませんでした", delError.message);
    else result.removed = gone.length;
  }
  if (delivered.length) {
    await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).in("id", delivered);
    result.sent = delivered.length;
  }
  return result;
}

// 通知を受け取る端末を 1 つ以上登録しているか
export async function hasPushDevice(admin: Db, userId: string): Promise<boolean> {
  const { count, error } = await admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw error;
  return (count ?? 0) > 0;
}
