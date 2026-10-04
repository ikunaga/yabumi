"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "./redirect";

export type AuthFormState = {
  error?: string;
  // エラーを示す欄（枠を赤くする）
  invalidField?: "email" | "password";
  message?: string;
  email?: string;
};

const credentialsSchema = z.object({
  email: z.email("メールアドレスの形式が正しくありません。もう一度お確かめください。"),
  password: z.string().min(8, "パスワードは 8 文字以上にしてください。").max(72, "パスワードは 72 文字以内にしてください。"),
});

function readCredentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
}

// Supabase のエラーを利用者向けの日本語に置き換える
function toJapaneseAuthError(code: string | undefined, fallback: string): string {
  switch (code) {
    case "invalid_credentials":
      return "メールアドレスかパスワードが違います。もう一度お試しください。";
    case "email_not_confirmed":
      return "メールアドレスの確認が済んでいません。届いた確認メールのリンクを開いてください";
    case "user_already_exists":
    case "email_exists":
      return "このメールアドレスはすでに登録されています。ログインしてください";
    case "weak_password":
      return "パスワードが弱すぎます。より長く、推測されにくいものにしてください";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "試行回数が多すぎます。しばらく待ってからやり直してください";
    default:
      return fallback;
  }
}

function invalidCredentials(error: z.ZodError, email: string): AuthFormState {
  const issue = error.issues[0];
  return { error: issue?.message, invalidField: issue?.path[0] === "email" ? "email" : "password", email };
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const parsed = readCredentials(formData);
  if (!parsed.success) {
    return invalidCredentials(parsed.error, email);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      error: toJapaneseAuthError(error.code, "ログインできませんでした。時間をおいてもう一度お試しください。"),
      invalidField: error.code === "invalid_credentials" ? "password" : undefined,
      email,
    };
  }

  redirect(safeNextPath(formData.get("next")));
}

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const parsed = readCredentials(formData);
  if (!parsed.success) {
    return invalidCredentials(parsed.error, email);
  }

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=/projects` },
  });
  if (error) {
    return {
      error: toJapaneseAuthError(error.code, "登録できませんでした。時間をおいてもう一度お試しください。"),
      invalidField: error.code === "weak_password" ? "password" : undefined,
      email,
    };
  }

  // メール確認が有効な環境ではセッションがまだ無い
  if (!data.session) {
    return { message: "確認メールを送りました。メール内のリンクを開くと登録が完了します。", email };
  }

  redirect("/projects");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
