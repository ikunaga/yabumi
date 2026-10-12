"use server";

import { redirect } from "next/navigation";
import { unsubscribeByToken } from "@/lib/coach/unsubscribe";

export async function unsubscribeAction(formData: FormData) {
  const token = String(formData.get("t") ?? "");
  const ok = await unsubscribeByToken(token);
  redirect(`/unsubscribe?t=${encodeURIComponent(token)}&done=${ok ? "1" : "0"}`);
}
