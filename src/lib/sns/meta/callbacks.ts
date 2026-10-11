import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/sns/threads/config";
import { parseSignedRequest, type SignedRequestPayload } from "./signed-request";

// Meta（Instagram・Facebook）から届く、外した・データの削除を求めた の通知の受け口の共通部分。
// 署名（アプリシークレットの HMAC）を確かめてから handle を呼ぶ。ログインなしで届くので proxy の公開パスに入れている

export async function handleDeauthorize(
  request: NextRequest,
  appSecret: string,
  handle: (payload: SignedRequestPayload) => Promise<unknown>,
): Promise<NextResponse> {
  const payload = await readPayload(request, appSecret);
  if (!payload) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  await handle(payload);
  return NextResponse.json({ ok: true });
}

// データの削除: その場で消し、確認のページの URL と確認コードを返す（Meta の決まった形式）
export async function handleDataDeletion(
  request: NextRequest,
  appSecret: string,
  sns: "instagram" | "facebook",
  handle: (payload: SignedRequestPayload) => Promise<unknown>,
): Promise<NextResponse> {
  const payload = await readPayload(request, appSecret);
  if (!payload) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  await handle(payload);
  const code = randomBytes(8).toString("hex");
  const url = new URL("/sns/deletion", appUrl());
  url.searchParams.set("sns", sns);
  url.searchParams.set("code", code);
  return NextResponse.json({ url: url.toString(), confirmation_code: code });
}

async function readPayload(request: NextRequest, appSecret: string): Promise<SignedRequestPayload | null> {
  const form = await request.formData().catch(() => null);
  const signed = form?.get("signed_request");
  return typeof signed === "string" ? parseSignedRequest(signed, appSecret) : null;
}
