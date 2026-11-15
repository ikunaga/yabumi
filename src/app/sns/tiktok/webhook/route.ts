import { NextResponse, type NextRequest } from "next/server";
import { adapters } from "@/lib/sns/adapters";
import { tiktokConfig, tiktokConfigured } from "@/lib/sns/tiktok/config";
import { handleTikTokWebhook, verifyTikTokSignature } from "@/lib/sns/tiktok/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

// TikTok の Webhook（docs/design/tiktok.md の 12.）。署名が合わなければ 401。確かめ終えたらすぐ 200（返さないと 72 時間やり直してくる）。
// こちらの確かめが TikTok の障害などでできなかったときだけ 500 を返し、やり直してもらう
export async function POST(request: NextRequest) {
  if (!tiktokConfigured()) return NextResponse.json({ error: "not configured" }, { status: 404 });
  const config = tiktokConfig();
  const raw = await request.text();
  if (raw.length > 64_000 || !verifyTikTokSignature(request.headers.get("tiktok-signature"), raw, config.clientSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  try {
    await handleTikTokWebhook(createAdminClient(), raw, { adapter: adapters.tiktok, clientKey: config.clientKey });
  } catch (e) {
    console.error("[tiktok webhook]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
