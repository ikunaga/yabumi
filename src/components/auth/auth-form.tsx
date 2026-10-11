"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { AuthFormState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Turnstile } from "./turnstile";

// login: ログイン / signup: 登録 / forgot: パスワードを忘れた（メールを送る） / reset: 新しいパスワードを決める
type Mode = "login" | "signup" | "forgot" | "reset";

const MIN_PASSWORD = 8;

const copy: Record<
  Mode,
  { title: string; lead?: string; submit: string; pending: string; switchText: string; switchLink: string; switchHref: string }
> = {
  login: {
    title: "ログイン",
    submit: "ログイン",
    pending: "ログイン中…",
    switchText: "はじめての方は",
    switchLink: "アカウントを作る",
    switchHref: "/signup",
  },
  signup: {
    title: "アカウントを作る",
    submit: "登録する",
    pending: "登録中…",
    switchText: "アカウントをお持ちの方は",
    switchLink: "ログイン",
    switchHref: "/login",
  },
  forgot: {
    title: "パスワードの再設定",
    lead: "登録したメールアドレスに、新しいパスワードを決めるためのリンクを送ります。",
    submit: "再設定のメールを送る",
    pending: "送信中…",
    switchText: "パスワードを思い出した方は",
    switchLink: "ログイン",
    switchHref: "/login",
  },
  reset: {
    title: "新しいパスワード",
    lead: "これから使うパスワードを決めてください。決めると、そのままログインした状態で使い始められます。",
    submit: "パスワードを変える",
    pending: "変更中…",
    switchText: "やめるときは",
    switchLink: "プロジェクトへ",
    switchHref: "/projects",
  },
};

function passwordHint(length: number) {
  if (length === 0) return `${MIN_PASSWORD} 文字以上。`;
  if (length < MIN_PASSWORD) return `${MIN_PASSWORD} 文字以上。あと ${MIN_PASSWORD - length} 文字です。`;
  return `${MIN_PASSWORD} 文字以上。条件を満たしています。`;
}

export function AuthForm({
  mode,
  action,
  next,
  initialError,
}: {
  mode: Mode;
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next?: string;
  initialError?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: initialError });
  const [passwordLength, setPasswordLength] = useState(0);
  // メールを送れたら（登録・再設定）フォームを隠し、二度押しを防ぐ。「入れ直す」で、その結果に対してだけフォームを戻す
  const [reopenedFor, setReopenedFor] = useState<AuthFormState | null>(null);
  const sent = (mode === "signup" || mode === "forgot") && Boolean(state.message) && reopenedFor !== state;
  const c = copy[mode];

  // エラーが出たら、読み上げと目視のためにエラー帯へ移る
  useEffect(() => {
    if (state.error) document.getElementById("auth-error")?.focus();
  }, [state]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-heading text-[28px] font-bold max-md:mt-6 max-md:text-[26px]">{c.title}</h1>
      {c.lead && <p className="-mt-2 text-[14px] leading-7 text-muted">{c.lead}</p>}
      {state.error && <ErrorBanner id="auth-error">{state.error}</ErrorBanner>}
      {state.message && <SuccessBanner>{state.message}</SuccessBanner>}
      {sent && (
        <p className="text-[14px] leading-7 text-muted">
          {state.email && <>送り先: {state.email}。</>}
          メールアドレスを間違えたときは{" "}
          <button type="button" onClick={() => setReopenedFor(state)} className="font-semibold text-primary hover:underline">
            入れ直す
          </button>
        </p>
      )}
      <form action={formAction} noValidate hidden={sent} className="flex flex-col gap-5">
        {next && <input type="hidden" name="next" value={next} />}
        {mode !== "reset" && (
          <Field label="メールアドレス" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              defaultValue={state.email}
              invalid={state.invalidField === "email"}
            />
          </Field>
        )}
        {mode !== "forgot" && (
          <Field
            label={mode === "reset" ? "新しいパスワード" : "パスワード"}
            htmlFor="password"
            hint={mode === "signup" || mode === "reset" ? passwordHint(passwordLength) : undefined}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={MIN_PASSWORD}
              required
              invalid={state.invalidField === "password"}
              onChange={(e) => setPasswordLength(e.target.value.length)}
            />
          </Field>
        )}
        {mode === "login" && (
          <Link href="/forgot-password" className="-mt-3 self-end text-[14px] font-semibold text-primary hover:underline">
            パスワードを忘れた
          </Link>
        )}
        {mode === "reset" && (
          <Field label="新しいパスワード（確認）" htmlFor="confirm">
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required invalid={state.invalidField === "password"} />
          </Field>
        )}
        {mode !== "reset" && <Turnstile resetKey={state} />}
        {mode === "signup" && (
          <p className="text-[14px] leading-[1.7] text-muted">
            登録すると、
            <Link href="/terms" target="_blank" className="text-primary hover:underline">
              利用規約
            </Link>
            と
            <Link href="/privacy" target="_blank" className="text-primary hover:underline">
              プライバシーポリシー
            </Link>
            に同意したものとします。
          </p>
        )}
        <Button type="submit" className="mt-1 h-12 w-full max-md:h-13" disabled={pending}>
          {pending ? c.pending : c.submit}
        </Button>
      </form>
      <p className="text-center text-[14px] text-muted">
        {c.switchText}{" "}
        <Link href={c.switchHref} className="font-semibold text-primary hover:underline">
          {c.switchLink}
        </Link>
      </p>
    </div>
  );
}
