"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { startLegalNoticeAction } from "@/lib/legal/notice-actions";

// 「全員に送る」。押すと確かめの文を出し、もう一度押して送る
export function LegalNoticeSend({ started, remaining }: { started: boolean; remaining: number }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string; notice?: string } | null>(null);
  const label = started ? `まだの ${remaining} 人に、今日の分を送る` : `全員（${remaining} 人）に送る`;

  return (
    <div className="flex flex-col gap-3">
      {result?.error && <p className="font-semibold text-danger">{result.error}</p>}
      {result?.notice && (
        <p role="status" className="font-semibold text-success">
          {result.notice}
        </p>
      )}
      {confirm ? (
        <div className="flex flex-wrap items-center gap-3">
          <span>知らせのメールを送ります。取り消せません。</span>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setResult(await startLegalNoticeAction());
                setConfirm(false);
              })
            }
          >
            {pending ? "送っています…" : "送る"}
          </Button>
          <Button type="button" size="sm" variant="text" disabled={pending} onClick={() => setConfirm(false)}>
            やめる
          </Button>
        </div>
      ) : (
        <Button type="button" className="w-fit" disabled={remaining === 0} onClick={() => setConfirm(true)}>
          {label}
        </Button>
      )}
    </div>
  );
}
