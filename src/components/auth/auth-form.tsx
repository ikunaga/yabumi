"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { AuthFormState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";

type Mode = "login" | "signup";

const MIN_PASSWORD = 8;

const copy: Record<Mode, { title: string; submit: string; pending: string; switchText: string; switchLink: string; switchHref: string }> = {
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
  const c = copy[mode];

  // エラーが出たら、読み上げと目視のためにエラー帯へ移る
  useEffect(() => {
    if (state.error) document.getElementById("auth-error")?.focus();
  }, [state]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-heading text-[28px] font-bold max-md:mt-6 max-md:text-[26px]">{c.title}</h1>
      {state.error && <ErrorBanner id="auth-error">{state.error}</ErrorBanner>}
      {state.message && <SuccessBanner>{state.message}</SuccessBanner>}
      <form action={formAction} noValidate className="flex flex-col gap-5">
        {next && <input type="hidden" name="next" value={next} />}
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
        <Field
          label="パスワード"
          htmlFor="password"
          hint={mode === "signup" ? passwordHint(passwordLength) : undefined}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={MIN_PASSWORD}
            required
            invalid={state.invalidField === "password"}
            onChange={(e) => setPasswordLength(e.target.value.length)}
          />
        </Field>
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
