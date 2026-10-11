"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "./redirect";
import { isSignupAllowed } from "./signup-policy";

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
    case "captcha_failed":
      return "ロボットでないことの確認が済んでいません。チェックが終わってから、もう一度押してください";
    case "same_password":
      return "いまと同じパスワードです。別のパスワードにしてください";
    case "otp_expired":
      return "リンクの期限が切れています。もう一度メールを送ってください";
    default:
      return fallback;
  }
}

// ロボットによる大量の登録・ログインを防ぐ確認（Cloudflare Turnstile）。NEXT_PUBLIC_TURNSTILE_SITE_KEY があるときだけ画面に出し、
// 確認の結果（トークン）を Supabase に渡す。確かめるのは Supabase 側（Bot and Abuse Protection に Turnstile の Secret Key を入れる）
function captchaToken(formData: FormData): string | undefined {
  const token = formData.get("cf-turnstile-response");
  return typeof token === "string" && token ? token : undefined;
}

// メールのリンクの戻り先。メールのテンプレートは Supabase の Site URL を使うが、既定のテンプレートのときのために渡しておく
async function requestOrigin(): Promise<string> {
  return (process.env.APP_URL || (await headers()).get("origin") || "").replace(/\/$/, "");
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
  const { error } = await supabase.auth.signInWithPassword({ ...parsed.data, options: { captchaToken: captchaToken(formData) } });
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
  // 本番はオーナーだけが登録できる（docs/deploy.md）。Supabase 側でも新規登録を閉じる
  if (!isSignupAllowed(parsed.data.email)) {
    return { error: "いまは招待した方だけが登録できます。", invalidField: "email", email };
  }

  const origin = await requestOrigin();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=/projects`, captchaToken: captchaToken(formData) },
  });
  if (error) {
    return {
      error: toJapaneseAuthError(error.code, "登録できませんでした。時間をおいてもう一度お試しください。"),
      invalidField: error.code === "weak_password" ? "password" : undefined,
      email,
    };
  }

  // メール確認が有効な環境ではセッションがまだ無い。
  // すでに登録済みのアドレスでも Supabase は同じ応答を返す（登録の有無を他人に知られないため）ので、文面もどちらにも合うようにする
  if (!data.session) {
    return {
      message: "確認メールを送りました。メール内のリンクを開くと登録が完了します。届かないときは、迷惑メールのフォルダも確かめてください。",
      email,
    };
  }

  redirect("/projects");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const emailSchema = z.email("メールアドレスの形式が正しくありません。もう一度お確かめください。");

// 「パスワードを忘れた」: 再設定のメールを送る。登録されていないアドレスでも同じ文面を返す（登録の有無を他人に知られないため）
export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, invalidField: "email", email };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await requestOrigin()}/auth/confirm?next=/reset-password`,
    captchaToken: captchaToken(formData),
  });
  if (error && ["over_email_send_rate_limit", "over_request_rate_limit", "captcha_failed"].includes(error.code ?? "")) {
    return { error: toJapaneseAuthError(error.code, ""), email };
  }
  if (error) console.error("[auth] 再設定のメールを送れませんでした", error.code ?? error.message);
  return {
    message: "このメールアドレスで登録があれば、パスワードを再設定するメールを送りました。届かないときは、迷惑メールのフォルダも確かめてください。",
    email,
  };
}

const newPasswordSchema = z
  .object({
    password: credentialsSchema.shape.password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "確認のパスワードが一致しません。", path: ["confirm"] });

// 再設定のメールのリンクから来た人が、新しいパスワードを決める（リンクを開いた時点でログインした状態になっている）
export async function updatePassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = newPasswordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, invalidField: "password" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { error: "リンクの期限が切れたか、ログインが外れています。もう一度、再設定のメールを送ってください。" };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      error: toJapaneseAuthError(error.code, "パスワードを変えられませんでした。時間をおいてもう一度お試しください。"),
      invalidField: "password",
    };
  }
  redirect("/projects?done=password_updated");
}
