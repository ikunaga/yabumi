"use server";

import { redirect } from "next/navigation";
import { unsubscribeByToken, unsubscribeKind } from "@/lib/coach/unsubscribe";

export async function unsubscribeAction(formData: FormData) {
  const token = String(formData.get("t") ?? "");
  const kind = unsubscribeKind(formData.get("k"));
  const ok = await unsubscribeByToken(token, kind);
  redirect(`/unsubscribe?t=${encodeURIComponent(token)}${kind === "auto" ? "&k=auto" : ""}&done=${ok ? "1" : "0"}`);
}
