"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteFromSns } from "@/lib/posts/send-actions";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { formatShort } from "@/lib/time";

export type TargetResult = {
  id: string;
  status: "pending" | "publishing" | "published" | "failed" | "deleted";
  externalUrl: string | null;
  errorMessage: string | null;
  publishedAt: string | null;
  nextAttemptAt: string | null;
};

// 送信の結果: 送れたものは SNS 上の投稿へのリンクと取り消し、送れなかったものは理由と「要確認」
export function SendResults({ projectId, postId, results }: { projectId: string; postId: string; results: Partial<Record<SnsKey, TargetResult>> }) {
  const rows = SNS_KEYS.flatMap((sns) => {
    const r = results[sns];
    if (!r || (r.status === "pending" && !r.errorMessage)) return [];
    return [{ sns, r }];
  });
  if (rows.length === 0) return null;

  return (
    <div className="border-b border-line">
      <h3 className="px-5 pt-3 text-xs font-bold text-muted">送信の結果</h3>
      <ul className="text-sm">
        {rows.map(({ sns, r }) => (
          <ResultRow key={sns} sns={sns} r={r} projectId={projectId} postId={postId} />
        ))}
      </ul>
    </div>
  );
}

function ResultRow({ sns, r, projectId, postId }: { sns: SnsKey; r: TargetResult; projectId: string; postId: string }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = SNS[sns].label;

  return (
    <li className="flex flex-col gap-1 px-5 py-2.5 leading-[1.6]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b>{label}</b>
        {r.status === "published" && (
          <>
            <span className="text-muted">{r.publishedAt ? `${formatShort(r.publishedAt)} に送信` : "送信済み"}</span>
            {r.externalUrl && (
              <a href={r.externalUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                {label} で見る
              </a>
            )}
            <span className="ml-auto">
              {confirm ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setError(null);
                      const res = await deleteFromSns(projectId, postId, r.id);
                      // 成功したらサーバーで画面を読み直すので、ここに来るのは失敗したときだけ
                      if (res?.error) setError(res.error);
                      setConfirm(false);
                    })
                  }
                >
                  {label} から消す
                </Button>
              ) : (
                <Button type="button" variant="text" size="sm" onClick={() => setConfirm(true)}>
                  {label} から取り消す
                </Button>
              )}
            </span>
          </>
        )}
        {r.status === "publishing" && <span className="text-muted">送信中です。しばらくしてから読み込み直してください。</span>}
        {r.status === "deleted" && <span className="text-muted">{label} から取り消しました（矢書の下書きは残っています）</span>}
        {r.status === "failed" && (
          <>
            <span className="font-bold text-danger">! 失敗</span>
            <span className="font-bold text-signal">要確認</span>
          </>
        )}
        {r.status === "pending" && r.errorMessage && (
          <span className="font-bold text-signal">
            送り直し待ち{r.nextAttemptAt ? `（${formatShort(r.nextAttemptAt)} ごろ）` : ""}
          </span>
        )}
      </div>
      {(r.status === "failed" || r.status === "pending") && r.errorMessage && <p className="text-muted">{r.errorMessage}</p>}
      {r.status === "failed" && <p className="text-xs text-muted">直してから「今すぐ送る」か「予約」で送り直せます。</p>}
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
