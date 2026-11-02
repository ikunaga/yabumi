import { z } from "zod";
import { isSameOriginJson } from "@/lib/http/same-origin";
import { deviceLabel } from "@/lib/push/rules";
import { renewDevice, subscriptionSchema } from "@/lib/push/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// ブラウザが通知の購読を新しくしたとき（service worker の pushsubscriptionchange）に、宛先を付け替える（docs/architecture.md の 4.28）。
// 本人はログインの cookie で確かめる。前の宛先がその人の登録で、新しい宛先がほかの人の登録でないときだけ付け替える（renewDevice）。
// ログインしていなければ何もしない（画面から登録し直せる）
const bodySchema = z.object({ oldEndpoint: z.string().max(1000).nullable(), subscription: subscriptionSchema });

export async function POST(request: Request) {
  // ほかのサイトから呼ばせない（service worker の fetch は同じサイトの JSON）
  if (!isSameOriginJson(request)) return new Response(null, { status: 403 });
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return new Response(null, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });

  const { oldEndpoint, subscription } = parsed.data;
  if (!oldEndpoint) return new Response(null, { status: 204 });
  const r = await renewDevice(createAdminClient(), userId, oldEndpoint, subscription, deviceLabel(request.headers.get("user-agent") ?? ""));
  return new Response(null, { status: r.ok || "skipped" in r ? 204 : 400 });
}
