import { z } from "zod";
import { deviceLabel } from "@/lib/push/rules";
import { registerDevice, removeDeviceByEndpoint, subscriptionSchema } from "@/lib/push/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// ブラウザが通知の購読を新しくしたとき（service worker の pushsubscriptionchange）に、宛先を付け替える（docs/architecture.md の 4.28）。
// 本人はログインの cookie で確かめる。前の宛先がその人の登録だったときだけ付け替える（ほかの人が登録した端末を、勝手にこの人の宛先にしない）。
// ログインしていなければ何もしない（画面から登録し直せる）
const bodySchema = z.object({ oldEndpoint: z.string().max(1000).nullable(), subscription: subscriptionSchema });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return new Response(null, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });

  const admin = createAdminClient();
  const { oldEndpoint, subscription } = parsed.data;
  if (!oldEndpoint) return new Response(null, { status: 204 });
  const { data: owned } = await admin.from("push_subscriptions").select("id").eq("user_id", userId).eq("endpoint", oldEndpoint).maybeSingle();
  if (!owned) return new Response(null, { status: 204 });
  if (oldEndpoint !== subscription.endpoint) await removeDeviceByEndpoint(admin, userId, oldEndpoint);
  const r = await registerDevice(admin, userId, subscription, deviceLabel(request.headers.get("user-agent") ?? ""));
  return new Response(null, { status: r.ok ? 204 : 400 });
}
