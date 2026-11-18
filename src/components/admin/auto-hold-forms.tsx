"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { holdAutoPostAction, releaseAutoPostAction } from "@/lib/auto-post/operator-actions";
import type { HoldRow } from "@/lib/auto-post/holds";

// 運営者の画面（/admin/auto-holds）: 自動の投稿を止める・解除する。押したら確かめの文を出し、もう一度押して実行する（招待の申し込みの行と同じ作り）

type Result = { ok: true; notice: string } | { ok: false; error: string } | null;

export function HoldForm() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      const r = await holdAutoPostAction(email, reason);
      setResult(r);
      setConfirm(false);
      if (r.ok) {
        setEmail("");
        setReason("");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {result && (result.ok ? <SuccessBanner>{result.notice}</SuccessBanner> : <ErrorBanner>{result.error}</ErrorBanner>)}
      <Field label="利用者のメールアドレス" htmlFor="hold-email" required>
        <Input id="hold-email" type="email" autoComplete="off" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="理由（運営者のメモ）" htmlFor="hold-reason" required hint="利用者には見せません。200 字まで">
        <Textarea id="hold-reason" rows={3} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {confirm ? (
        <div className="flex flex-wrap items-center gap-3 text-[15px]">
          <span>この利用者の自動の投稿を止め、まだ送っていない回を取り消して、投稿を下書きに戻します。</span>
          <Button type="button" size="sm" variant="danger" disabled={pending} onClick={run}>
            {pending ? "止めています…" : "止める"}
          </Button>
          <Button type="button" size="sm" variant="text" disabled={pending} onClick={() => setConfirm(false)}>
            やめる
          </Button>
        </div>
      ) : (
        <div>
          <Button type="button" disabled={!email.trim() || !reason.trim()} onClick={() => setConfirm(true)}>
            止める
          </Button>
        </div>
      )}
    </div>
  );
}

export function HoldListRow({ hold, heldAt }: { hold: HoldRow; heldAt: string }) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [pending, start] = useTransition();
  const id = `release-${hold.id}`;

  if (result?.ok) {
    return (
      <li className="px-6 py-3 text-[15px] text-success max-sm:px-4" role="status">
        {hold.email}: {result.notice}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 px-6 py-4 text-[15px] max-sm:px-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <b className="break-all">{hold.email}</b>
        <span className="num text-[13px] text-faint">{heldAt}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
        <dt>理由</dt>
        <dd className="break-words text-fg">{hold.reason}</dd>
        <dt>止めた人</dt>
        <dd className="break-all text-fg">{hold.heldBy}</dd>
      </dl>
      {result && !result.ok && <p className="font-semibold text-danger">{result.error}</p>}
      {confirm ? (
        <div className="flex flex-col gap-2">
          <Field label="解除の理由（運営者のメモ）" htmlFor={id} required>
            <Input id={id} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <span>解除すると、動いている自動の投稿は、最初の回を確かめてから送ります。</span>
            <Button type="button" size="sm" disabled={pending || !reason.trim()} onClick={() => start(async () => setResult(await releaseAutoPostAction(hold.email, reason)))}>
              {pending ? "解除しています…" : "解除する"}
            </Button>
            <Button type="button" size="sm" variant="text" disabled={pending} onClick={() => setConfirm(false)}>
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" size="sm" variant="secondary" onClick={() => setConfirm(true)}>
            解除する
          </Button>
        </div>
      )}
    </li>
  );
}
