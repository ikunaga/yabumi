"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { declineAction, inviteAction } from "@/lib/waitlist/actions";
import type { WaitlistEntry } from "@/lib/waitlist/store";

// 招待の申し込みの 1 行（運営者の画面）。押したら確かめの文を出し、もう一度押して実行する
export function WaitlistRow({ entry, createdAt }: { entry: WaitlistEntry; createdAt: string }) {
  const [confirm, setConfirm] = useState<"invite" | "decline" | null>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string; notice?: string } | null>(null);

  function run(kind: "invite" | "decline") {
    start(async () => {
      setResult(await (kind === "invite" ? inviteAction(entry.id) : declineAction(entry.id)));
      setConfirm(null);
    });
  }

  if (result?.notice) {
    return (
      <li className="px-5 py-3 text-[14px] text-success" role="status">
        {entry.email}: {result.notice}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 px-5 py-4 text-[14px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <b className="break-all">{entry.email}</b>
        <span className="text-xs text-muted">{createdAt}</span>
      </div>
      {(entry.appNote || entry.snsNote) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
          {entry.appNote && (
            <>
              <dt>アプリ</dt>
              <dd className="break-words text-fg">{entry.appNote}</dd>
            </>
          )}
          {entry.snsNote && (
            <>
              <dt>SNS</dt>
              <dd className="break-words text-fg">{entry.snsNote}</dd>
            </>
          )}
        </dl>
      )}
      {result?.error && <p className="font-semibold text-danger">{result.error}</p>}
      {confirm ? (
        <div className="flex flex-wrap items-center gap-3">
          <span>{confirm === "invite" ? "招待のメールを送り、申し込みを消します。" : "メールを送らずに、申し込みを消します。"}</span>
          <Button type="button" size="sm" variant={confirm === "invite" ? "primary" : "danger"} disabled={pending} onClick={() => run(confirm)}>
            {pending ? "しています…" : confirm === "invite" ? "招待する" : "お断りする"}
          </Button>
          <Button type="button" size="sm" variant="text" disabled={pending} onClick={() => setConfirm(null)}>
            やめる
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" onClick={() => setConfirm("invite")}>
            招待する
          </Button>
          <Button type="button" size="sm" variant="text" onClick={() => setConfirm("decline")}>
            お断りする
          </Button>
        </div>
      )}
    </li>
  );
}
