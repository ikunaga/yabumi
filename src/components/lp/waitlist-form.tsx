"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import { Turnstile } from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { type ApplyState, applyAction } from "@/lib/waitlist/actions";
import { MAX_NOTE_CHARS } from "@/lib/waitlist/rules";

// 招待の申し込み（F19。docs/architecture.md の 4.29）。メールアドレスと、任意の一言 2 つ
export function WaitlistForm() {
  const [state, action, pending] = useActionState<ApplyState, FormData>(applyAction, { status: "idle" });
  const id = useId();

  if (state.status === "done") {
    return (
      <div role="status" className="flex flex-col gap-2 self-start rounded-lg border border-success bg-success-soft px-5 py-4 text-[15px] leading-[1.8] text-success">
        <p className="font-bold">申し込みを受け付けました。ありがとうございます。</p>
        <p className="text-fg">
          {state.mailed ? "確認のメールをお送りしました。届かないときは、迷惑メールのフォルダも確かめてください。" : ""}
          順番に、招待のメール（件名「矢書への招待」）をお送りします。
        </p>
      </div>
    );
  }

  const values = state.status === "error" ? state : { email: "", appNote: "", snsNote: "" };

  return (
    <form action={action} className="flex flex-col gap-4" noValidate={false}>
      {state.status === "error" && <ErrorBanner>{state.message}</ErrorBanner>}
      <Field label="メールアドレス" htmlFor={`${id}-email`} required hint="招待のメールをここに送ります。">
        <Input id={`${id}-email`} name="email" type="email" required autoComplete="email" inputMode="email" maxLength={254} defaultValue={values.email} placeholder="you@example.com" />
      </Field>
      <Field label="作っているアプリ" htmlFor={`${id}-app`} optional hint="一言で大丈夫です。招待の順番の参考にします。">
        <Input id={`${id}-app`} name="app_note" maxLength={MAX_NOTE_CHARS} defaultValue={values.appNote} placeholder="例: レシートを撮るだけの家計簿アプリ（iOS）" />
      </Field>
      <Field label="使っている SNS" htmlFor={`${id}-sns`} optional>
        <Input id={`${id}-sns`} name="sns_note" maxLength={MAX_NOTE_CHARS} defaultValue={values.snsNote} placeholder="例: X をたまに。Instagram はこれから" />
      </Field>
      {/* ロボット対策: 人には見えない欄（入力があれば受け付けない） */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>ウェブサイト</label>
        <input id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <Turnstile resetKey={state} />
      <p className="text-xs leading-[1.7] text-muted">
        申し込むと、<Link href="/privacy" className="text-primary underline">プライバシーポリシー</Link>
        に沿って、メールアドレスと一言をお預かりします。招待・お断り・取り消しのどれかで、すぐに消します（そのままなら 1 年で消します）。
      </p>
      <Button type="submit" disabled={pending} className="w-fit max-sm:h-13 max-sm:w-full">
        {pending ? "送っています…" : "招待を申し込む"}
      </Button>
    </form>
  );
}
