"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/feedback";
import { deleteAutoPlan, pauseAllAutoPlans, setAutoPlanStatus, skipNextAutoRun } from "@/lib/auto-post/actions";
import type { AutoPlanStatus } from "@/lib/auto-post/types";

// 作り終えてまだ送っていない予約をどうするか（止める・消す・全部止めるで選ぶ。初期値は下書きに戻す。2.3）
function ToDraftChoice({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 font-bold">作り終えた予約</legend>
      <label className="flex items-center gap-2">
        <input type="radio" className="size-4 accent-[var(--primary)]" checked={value} onChange={() => onChange(true)} />
        下書きに戻す（送らない）
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" className="size-4 accent-[var(--primary)]" checked={!value} onChange={() => onChange(false)} />
        そのまま送る
      </label>
    </fieldset>
  );
}

type Dialog = "pause" | "skip" | "delete" | null;

// 回し方の画面の右の操作: 直す・止める／再開する・次の回を飛ばす・削除する（1.6）
// held: 運営者が止めている（編集・止める・再開するは押せない。飛ばす・削除するはできる。止めるを押せないのは、
// 止めている間に押せると、運営者が止めたのと利用者が止めたのが混ざってわかりにくいため。2026-11-21 確認役の通しの確認・PM の指示）
// formatChanged: フォーマットの変数が変わって止まった（要確認）。「再開する」は押せず、「編集」で決め方を選び直して保存すると動き出す（format-series.md の 1.2）
export function PlanControls({
  projectId,
  planId,
  status,
  nextLabel,
  held = false,
  formatChanged = false,
}: {
  projectId: string;
  planId: string;
  status: AutoPlanStatus;
  nextLabel: string | null;
  held?: boolean;
  formatChanged?: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toDraft, setToDraft] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      setNotice(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? null);
      else {
        after?.();
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2 max-sm:grid max-sm:grid-cols-2">
        {held ? (
          <Button type="button" variant="secondary" size="sm" disabled>
            編集
          </Button>
        ) : (
          <ButtonLink href={`/projects/${projectId}/auto/${planId}/edit`} variant="secondary" size="sm">
            編集
          </ButtonLink>
        )}
        {status === "active" ? (
          <Button type="button" variant="secondary" size="sm" disabled={pending || held} onClick={() => setDialog("pause")}>
            止める
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="sm" disabled={pending || held || formatChanged} onClick={() => run(() => setAutoPlanStatus(projectId, planId, "active"))}>
            再開する
          </Button>
        )}
        {status === "active" && (
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("skip")}>
            次の投稿を飛ばす
          </Button>
        )}
        <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => setDialog("delete")}>
          削除する
        </Button>
      </div>
      {formatChanged && !held && <p className="text-sm text-muted">「編集」で変数の決め方を選び直して保存すると、動き出します。</p>}
      {held && (
        <p className="text-sm text-muted">
          {status === "active" ? "yabumi の運営が止めている間は、編集も、止めることもできません。" : "yabumi の運営が止めている間は、編集も、再開もできません。"}
        </p>
      )}

      <ConfirmDialog
        open={dialog === "pause"}
        title="この自動投稿を止めますか"
        confirmLabel="止める"
        onClose={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          run(() => setAutoPlanStatus(projectId, planId, "paused", toDraft));
        }}
      >
        <p>止めている間は、新しい投稿はつくられません。いつでも再開できます。</p>
        <ToDraftChoice value={toDraft} onChange={setToDraft} />
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "skip"}
        title="次の投稿を飛ばしますか"
        confirmLabel="飛ばす"
        onClose={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          run(
            () => skipNextAutoRun(planId),
            () => setNotice("次の投稿を飛ばしました。"),
          );
        }}
      >
        <p>{nextLabel ? `${nextLabel} の投稿を送りません。作り終えていれば、下書きに戻します。` : "次の投稿を送りません。"}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "delete"}
        title="この自動投稿を削除しますか"
        confirmLabel="削除する"
        onClose={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          start(async () => {
            setError(null);
            const r = await deleteAutoPlan(planId, toDraft);
            if (!r.ok) setError(r.error);
            else router.push(`/projects/${projectId}/auto`);
          });
        }}
      >
        <p>設定と、これまでの投稿の記録を削除します。送信済みの投稿は残ります。元に戻せません。</p>
        <ToDraftChoice value={toDraft} onChange={setToDraft} />
      </ConfirmDialog>
    </div>
  );
}

// 一覧の右上の「全部止める」
// held: 運営者が止めている（押せない。理由を 1 行出す。2026-11-21 PM の指示）
export function PauseAllButton({ projectId, activeCount, held = false }: { projectId: string; activeCount: number; held?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toDraft, setToDraft] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button type="button" variant="secondary" size="sm" disabled={pending || activeCount === 0 || held} onClick={() => setOpen(true)}>
        全部止める
      </Button>
      {held && <p className="text-sm text-muted">yabumi の運営が止めているので、いまは押せません。</p>}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <ConfirmDialog
        open={open}
        title="自動投稿を全部止めますか"
        confirmLabel="全部止める"
        onClose={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          start(async () => {
            setError(null);
            const r = await pauseAllAutoPlans(projectId, toDraft);
            if (!r.ok) setError(r.error);
            else router.refresh();
          });
        }}
      >
        <p>運用中の {activeCount} 件を止めます。それぞれの画面から再開できます。</p>
        <ToDraftChoice value={toDraft} onChange={setToDraft} />
      </ConfirmDialog>
    </>
  );
}
