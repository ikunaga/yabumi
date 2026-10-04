import { NextResponse, type NextRequest } from "next/server";
import { revokeAccountsByExternalId } from "@/lib/sns/accounts";
import { parseSignedRequest } from "@/lib/sns/threads/signed-request";
import { threadsConfig } from "@/lib/sns/threads/config";
import { createAdminClient } from "@/lib/supabase/admin";

// Uninstall Callback URL: 利用者が Threads の設定から矢書を外したときに Meta から届く
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const signed = form?.get("signed_request");
  const payload = typeof signed === "string" ? parseSignedRequest(signed, threadsConfig().appSecret) : null;
  if (!payload) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });

  await revokeAccountsByExternalId(createAdminClient(), "threads", payload.user_id);
  return NextResponse.json({ ok: true });
}
