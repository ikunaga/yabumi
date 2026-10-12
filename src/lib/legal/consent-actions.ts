"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { consentVia, recordConsent } from "./consent";
import { currentLegalVersion } from "./version";

// ログインしたあとの同意の帯から、同意を記録する（決定 D31）
export type ConsentState = { error?: string };

export async function acceptConsent(_prev: ConsentState, formData: FormData): Promise<ConsentState> {
  if (formData.get("consent") !== "on") return { error: "同意の欄に印を付けてから押してください。" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { error: "ログインし直してください。" };
  try {
    await recordConsent(supabase, currentLegalVersion(), await consentVia(supabase, false));
  } catch (e) {
    console.error("[consent] 同意を記録できませんでした", e instanceof Error ? e.message : e);
    return { error: "記録できませんでした。時間をおいてもう一度お試しください。" };
  }
  revalidatePath("/", "layout");
  return {};
}
