"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { settleGoalAction } from "@/lib/goals/actions";

// この目標を終える（AI なしで。結果を数えて「これまでの目標」に移す）。押す前に確かめる
export function SettleGoalButton({ projectId, goalId, statement }: { projectId: string; goalId: string; statement: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setOpen(true)}>
        {pending ? "終えています…" : "この目標を終える"}
      </Button>
      {error && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={open}
        title="この目標を終えますか"
        confirmLabel="終える"
        onClose={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          start(async () => {
            const r = await settleGoalAction(projectId, goalId);
            setError(r.error ?? null);
          });
        }}
      >
        <p>「{statement}」の結果を今日までの数字で数えて、「これまでの目標」に移します。週の投稿の本数はそのまま続きます。次の目標は、あとから決められます。</p>
      </ConfirmDialog>
    </div>
  );
}
