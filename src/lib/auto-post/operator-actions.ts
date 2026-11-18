"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isOperatorEmail } from "@/lib/waitlist/operator";
import { holdAutoPost, releaseAutoPost, type OperatorResult } from "./holds";

// 運営者の画面（/admin/auto-holds）の操作。運営者（OPERATOR_ADMIN_EMAILS）でなければ 404。だれが止めた・解除したかは、運営者のメールアドレスで残す

async function operatorEmail(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  if (!email || !isOperatorEmail(email)) notFound();
  return email;
}

const input = z.object({ email: z.email().max(254), reason: z.string().trim().min(1).max(200) });
const BAD = { ok: false as const, error: "メールアドレスと、1〜200 字の理由を入れてください。" };

export async function holdAutoPostAction(email: string, reason: string): Promise<OperatorResult> {
  const by = await operatorEmail();
  const v = input.safeParse({ email: email.trim(), reason });
  if (!v.success) return BAD;
  const r = await holdAutoPost(createAdminClient(), { ...v.data, by });
  revalidatePath("/admin/auto-holds");
  return r;
}

export async function releaseAutoPostAction(email: string, reason: string): Promise<OperatorResult> {
  const by = await operatorEmail();
  const v = input.safeParse({ email: email.trim(), reason });
  if (!v.success) return BAD;
  const r = await releaseAutoPost(createAdminClient(), { ...v.data, by });
  revalidatePath("/admin/auto-holds");
  return r;
}
