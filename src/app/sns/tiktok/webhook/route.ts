import { NextResponse, type NextRequest } from "next/server";
import { adapters } from "@/lib/sns/adapters";
import { tiktokConfig, tiktokConfigured } from "@/lib/sns/tiktok/config";
import { handleTikTokWebhook, verifyTikTokSignature } from "@/lib/sns/tiktok/webhook";
import { createAdminClient } from "@/lib/supabase/admin";
import { readLimitedText } from "@/lib/http/limited-body";

const MAX_WEBHOOK_BYTES = 64_000;

// TikTok の Webhook（docs/design/tiktok.md の 12.）。署名が合わなければ 401。確かめ終えたらすぐ 200（返さないと 72 時間やり直してくる）。
// こちらの確かめが TikTok の障害などでできなかったときだけ 500 を返し、やり直してもらう
export async function POST(request: NextRequest) {
  if (!tiktokConfigured()) return NextResponse.json({ error: "not configured" }, { status: 404 });
  const config = tiktokConfig();
  // 本文は 64KB まで。Content-Length を見てから読み、読む量も 64KB で止める（大きな本文を全部読ませない。セキュリティ確認の L3）
  const raw = await readLimitedText(request, MAX_WEBHOOK_BYTES);
  if (raw === null) return NextResponse.json({ error: "too large" }, { status: 413 });
  if (!verifyTikTokSignature(request.headers.get("tiktok-signature"), raw, config.clientSecret)) {
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
