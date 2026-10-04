"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteFromSns, markManualPosted } from "@/lib/posts/send-actions";
import { SNS, SNS_KEYS, isManualSns, type SnsKey } from "@/lib/sns";
import { formatShort } from "@/lib/time";

export type TargetResult = {
  id: string;
  status: "pending" | "publishing" | "published" | "failed" | "deleted";
  externalUrl: string | null;
  errorMessage: string | null;
  publishedAt: string | null;
  nextAttemptAt: string | null;
  // 手で投稿する SNS 用: 保存してあるタイトルと本文、投稿の画面の URL
  manual?: { title: string | null; text: string; composeUrl: string | null };
};

// 送信の結果: 送れたものは SNS 上の投稿へのリンクと取り消し、送れなかったものは理由と「要確認」
export function SendResults({ projectId, postId, results }: { projectId: string; postId: string; results: Partial<Record<SnsKey, TargetResult>> }) {
  const rows = SNS_KEYS.flatMap((sns) => {
    const r = results[sns];
    if (!r) return [];
    // 手で投稿する SNS は、投稿するまでの手順をいつも出す
    if (isManualSns(sns) && r.manual) return [{ sns, r }];
    if (r.status === "pending" && !r.errorMessage) return [];
    return [{ sns, r }];
  });
  if (rows.length === 0) return null;

  return (
    <div className="border-b border-line">
      <h3 className="px-5 pt-3 text-xs font-bold text-muted">送信の結果</h3>
      <ul className="text-sm">
        {rows.map(({ sns, r }) =>
          isManualSns(sns) && r.manual ? (
            <ManualRow key={sns} sns={sns} r={r} projectId={projectId} postId={postId} />
          ) : (
            <ResultRow key={sns} sns={sns} r={r} projectId={projectId} postId={postId} />
          ),
        )}
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

// 手で投稿する SNS（note・Substack）: 本文をコピー → 投稿の画面を開く → 投稿したら「投稿した」で記録
function ManualRow({ sns, r, projectId, postId }: { sns: SnsKey; r: TargetResult; projectId: string; postId: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState<"title" | "body" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = SNS[sns].label;
  const m = r.manual!;

  async function copy(kind: "title" | "body", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("コピーできませんでした。本文を選んでコピーしてください。");
    }
  }

  if (r.status === "published") {
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 leading-[1.6]">
        <b>{label}</b>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">手で投稿</span>
        <span className="font-bold text-success">✓ 投稿済み</span>
        {r.publishedAt && <span className="text-muted">{formatShort(r.publishedAt)} に記録</span>}
        {r.externalUrl && (
          <a href={r.externalUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
            {label} で見る
          </a>
        )}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2.5 px-5 py-3 leading-[1.6]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b>{label}</b>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">手で投稿</span>
        <span className="text-muted">{label} には公式の投稿のしくみがないので、ここから手で投稿します</span>
      </div>
      <ol className="flex flex-col gap-2 text-sm">
        <li className="flex flex-wrap items-center gap-2">
          <span className="text-muted">1.</span>
          {m.title && (
            <Button type="button" variant="secondary" size="sm" onClick={() => copy("title", m.title!)}>
              {copied === "title" ? "コピーしました" : "タイトルをコピー"}
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => copy("body", m.text)}>
            {copied === "body" ? "コピーしました" : "本文をコピー"}
          </Button>
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span className="text-muted">2.</span>
          {m.composeUrl ? (
            <a href={m.composeUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
              {label} の投稿の画面を開く
            </a>
          ) : (
            <span className="text-muted">{label} を開いて、新しい記事を作る</span>
          )}
          <span className="text-xs text-muted">（貼り付けて投稿します）</span>
        </li>
        <li className="flex flex-col gap-1.5">
          <span>
            <span className="text-muted">3.</span> 投稿したら、記録します。投稿の URL は任意です
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={`${label} の記事の URL（https://…）`}
              aria-label={`${label} の記事の URL`}
              className="min-w-0 flex-1 rounded-md border border-input bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
            />
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await markManualPosted(projectId, postId, r.id, url);
                  if (res?.error) setError(res.error);
                })
              }
            >
              投稿した
            </Button>
          </div>
        </li>
      </ol>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
