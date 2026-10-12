import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { removeDeviceOnLogout } from "./store";

// この端末で登録した通知の宛先の id（httpOnly、1 年）。ログアウトのときに、この端末への通知を止めるために使う（4.28）
export const PUSH_DEVICE_COOKIE = "yabumi_push_device";

// ログアウトの前に呼ぶ。この端末を外し、cookie を消す（失敗してもログアウトは続ける）
export async function forgetPushDevice(userId: string | null) {
  const jar = await cookies();
  const id = jar.get(PUSH_DEVICE_COOKIE)?.value;
  if (!id) return;
  jar.delete(PUSH_DEVICE_COOKIE);
  if (!userId || !/^[0-9a-f-]{36}$/.test(id)) return;
  try {
    await removeDeviceOnLogout(createAdminClient(), userId, id);
  } catch (e) {
    console.error("[push] ログアウトのときに端末を外せませんでした", e instanceof Error ? e.message : e);
  }
}
