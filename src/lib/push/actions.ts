"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PUSH_DEVICE_COOKIE } from "./cookie";
import { deviceLabel } from "./rules";
import { vapidPublicKey } from "./send";
import { type PushDevice, deviceIdOf, listDevices, registerDevice, removeDevice, sendTestPush, subscriptionSchema } from "./store";

// スマホの通知の画面（PushSettings）から呼ぶ操作（docs/architecture.md の 4.28）

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, userId: data?.claims?.sub ?? null };
}

const LOGIN = { error: "ログインし直してください。" };
const BAD_INPUT = { error: "入力の形式が正しくありません。画面を読み込み直してください。" };
const uuid = z.uuid();
const ONE_YEAR = 365 * 24 * 60 * 60;

// この端末の id を cookie に覚える（ログアウトしたときに、この端末への通知を止めるため。中身は端末の id だけ）
async function rememberDevice(id: string | null) {
  const jar = await cookies();
  if (id) jar.set(PUSH_DEVICE_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ONE_YEAR });
  else jar.delete(PUSH_DEVICE_COOKIE);
}

export type PushStatus = { publicKey: string | null; devices: PushDevice[]; currentId: string | null };

// 画面を開いたときの状態。endpoint はこのブラウザがすでに持っている購読（なければ null）
export async function pushStatus(endpoint: string | null): Promise<PushStatus | { error: string }> {
  const { supabase, userId } = await currentUser();
  if (!userId) return LOGIN;
  const e = z.string().max(1000).nullable().safeParse(endpoint);
  if (!e.success) return BAD_INPUT;
  const [devices, currentId] = await Promise.all([listDevices(supabase), e.data ? deviceIdOf(supabase, e.data) : Promise.resolve(null)]);
  return { publicKey: vapidPublicKey(), devices, currentId };
}

// この端末を登録する（利用者がボタンを押して、ブラウザが通知を許可したあと）
export async function subscribeDevice(subscription: unknown): Promise<{ id?: string; error?: string }> {
  const { userId } = await currentUser();
  if (!userId) return LOGIN;
  const s = subscriptionSchema.safeParse(subscription);
  if (!s.success) return BAD_INPUT;
  const label = deviceLabel((await headers()).get("user-agent") ?? "");
  const r = await registerDevice(createAdminClient(), userId, s.data, label);
  if (!r.ok) return { error: r.message };
  await rememberDevice(r.id);
  return { id: r.id };
}

// 端末を外す（この端末でも、ほかの端末でも）
export async function unsubscribeDevice(id: unknown): Promise<{ error?: string }> {
  const { supabase, userId } = await currentUser();
  if (!userId) return LOGIN;
  const i = uuid.safeParse(id);
  if (!i.success) return BAD_INPUT;
  const r = await removeDevice(supabase, i.data);
  if (!r.ok) return { error: r.message };
  const jar = await cookies();
  if (jar.get(PUSH_DEVICE_COOKIE)?.value === i.data) await rememberDevice(null);
  return {};
}

// 「試しに送る」
export async function testPushDevice(id: unknown): Promise<{ error?: string }> {
  const { userId } = await currentUser();
  if (!userId) return LOGIN;
  const i = uuid.safeParse(id);
  if (!i.success) return BAD_INPUT;
  const r = await sendTestPush(createAdminClient(), userId, i.data);
  return r.ok ? {} : { error: r.message };
}
