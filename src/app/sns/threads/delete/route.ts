import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { deleteAccountsByExternalId } from "@/lib/sns/accounts";
import { parseSignedRequest } from "@/lib/sns/threads/signed-request";
import { appUrl, THREADS_PATHS, threadsConfig } from "@/lib/sns/threads/config";
import { createAdminClient } from "@/lib/supabase/admin";

// Delete Callback URL: 利用者がデータの削除を求めたときに Meta から届く。
// その場で消し、確認用の URL と確認コードを返す（Meta の決まった形式）
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const signed = form?.get("signed_request");
  const payload = typeof signed === "string" ? parseSignedRequest(signed, threadsConfig().appSecret) : null;
  if (!payload) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });

  await deleteAccountsByExternalId(createAdminClient(), "threads", payload.user_id);

  const code = randomBytes(8).toString("hex");
  const url = new URL(THREADS_PATHS.deletionStatus, appUrl());
  url.searchParams.set("code", code);
  return NextResponse.json({ url: url.toString(), confirmation_code: code });
}
