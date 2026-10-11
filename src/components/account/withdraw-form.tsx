"use client";

import { useActionState, useState } from "react";
import { Turnstile } from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { withdraw, type WithdrawState } from "@/lib/account/actions";

// 退会のフォーム。消えるものを確かめるチェックと、パスワードの入れ直し
export function WithdrawForm() {
  const [state, action, pending] = useActionState<WithdrawState, FormData>(withdraw, {});
  const [understood, setUnderstood] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-4 border-t border-line pt-4">
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="understood"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
          className="mt-1.5 size-4 accent-[var(--primary)]"
        />
        上のデータが消え、元に戻せないことを確かめました
      </label>
      <Field label="パスワード（本人の確認のため）" htmlFor="withdraw-password">
        <Input id="withdraw-password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Turnstile resetKey={state} />
      <Button type="submit" variant="danger" className="self-start" disabled={!understood || pending}>
        {pending ? "退会の手続き中…" : "退会する"}
      </Button>
    </form>
  );
}
