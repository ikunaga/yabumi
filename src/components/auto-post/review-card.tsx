"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/feedback";
import { SnsTag } from "@/components/ui/marks";
import { approveAutoTarget, declineAutoTarget, reviewAutoRun } from "@/lib/auto-post/actions";
import { mediaForSns, type ReviewMedia } from "@/lib/auto-post/review-media";
import type { AutoReviewItem, AutoTargetPreview } from "@/lib/auto-post/types";
import { formatDuration } from "@/lib/media/video-rules";
import { SNS, type SnsKey } from "@/lib/sns";

// 確かめ待ちの 1 回（docs/design/auto-post.md の 1.6、src/lib/auto-post/README.md の「確かめる」）。
// 送る中身（題・本文・画像と画像の説明・動画）を SNS ごとにそのまま見せる（X の開発者ポリシー「Show exactly what will be published」）。
// first_review: 回ごとに「送る」「直す」「この回は送らない」。approval: 確かめ待ちの SNS ごとに「送る」「直す」「この SNS には送らない」
export function ReviewCard({ projectId, item, dueLabel }: { projectId: string; item: AutoReviewItem; dueLabel: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"skip" | { decline: AutoTargetPreview } | null>(null);
  const [pending, start] = useTransition();
  const postHref = `/projects/${projectId}/posts/${item.postId}`;
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? null);
      router.refresh();
    });

  const first = item.kind === "first_review";
  const waiting = item.targets.filter((t) => t.status === "awaiting_approval");
  const others = item.targets.filter((t) => t.status !== "awaiting_approval");

  return (
    <Card className="flex flex-col gap-4 px-6 py-5 max-sm:px-4 max-sm:py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[17px] font-bold">{item.planName}</span>
          {first && <Badge tone="signal">1 回目の投稿</Badge>}
        </p>
        <p className="num text-sm text-muted">{dueLabel} に送ります</p>
      </div>
      {first && (
        <p className="text-[14px] text-muted">1 回目の投稿だけ、送る前に確認してください。押さなければ送りません。2 回目からは、確認せずに送ります。「確認して送る」にした SNS は、毎回確認します。</p>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {(first ? item.targets : waiting).map((t) => (
        <div key={t.targetId} className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <SnsTag sns={t.sns} />
              {/* SNS ごとにどうなるか（2026-11-21 確認役の通しの確認）。1 回目の投稿は下書きのままなので、どの SNS も「これで送る」を押すまで送らない */}
              <span className="text-sm text-muted">{first ? "「これで送る」を押すと、予約の日時に送ります" : "「送る」を押すと、予約の日時に送ります。押さないと送りません"}</span>
            </span>
          </div>
          {t.title && <p className="text-[15px] font-bold whitespace-pre-wrap">{t.title}</p>}
          <p className="text-[15px] leading-[1.8] break-words whitespace-pre-wrap">{t.body}</p>
          <TargetMedia sns={t.sns} media={item.media} />
          {!first && (
            <div className="flex flex-wrap justify-end gap-2 max-sm:grid max-sm:grid-cols-3">
              <Button type="button" size="sm" disabled={pending} onClick={() => run(() => approveAutoTarget(t.targetId, t.fingerprint))}>
                送る
              </Button>
              <ButtonLink href={postHref} variant="secondary" size="sm">
                編集
              </ButtonLink>
              <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => setConfirm({ decline: t })}>
                送らない
              </Button>
            </div>
          )}
        </div>
      ))}

      {!first && others.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          {others.map((t) => (
            <SnsTag key={t.targetId} sns={t.sns} />
          ))}
          は、{waiting.map((t) => SNS[t.sns].label).join("・")} の確認とは関係なく、予約の日時に送ります。
          <Link href={postHref} className="underline">
            中身を見る
          </Link>
        </p>
      )}

      {first && (
        <div className="flex flex-wrap items-center justify-end gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
          <Button type="button" variant="text" disabled={pending} onClick={() => setConfirm("skip")}>
            この投稿は送らない
          </Button>
          <ButtonLink href={postHref} variant="secondary">
            編集
          </ButtonLink>
          <Button type="button" disabled={pending} onClick={() => run(() => reviewAutoRun(item.runId, true, Object.fromEntries(item.targets.map((t) => [t.targetId, t.fingerprint]))))}>
            {pending ? "送っています…" : "これで送る"}
          </Button>
        </div>
      )}
      {first && <p className="text-xs text-muted">編集したら、この画面に戻って確認してください。投稿の画面でそのまま予約しても送れます。</p>}
      {!first && waiting.length > 0 && <p className="text-xs text-muted">編集すると、確認待ちに戻ります。編集したら、この画面で確認し直してください。</p>}

      <ConfirmDialog
        open={confirm === "skip"}
        title="この投稿は送りませんか"
        confirmLabel="送らない"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          run(() => reviewAutoRun(item.runId, false));
        }}
      >
        <p>この投稿を取り消します。作った文は下書きに残ります。次の投稿も、送る前に確認してもらいます。</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!confirm && confirm !== "skip"}
        title={confirm && confirm !== "skip" ? `${SNS[confirm.decline.sns].label} には送りませんか` : ""}
        confirmLabel="送らない"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const t = confirm && confirm !== "skip" ? confirm.decline : null;
          setConfirm(null);
          if (t) run(() => declineAutoTarget(t.targetId));
        }}
      >
        <p>この投稿の送り先から外します。ほかの SNS は予約のまま送ります。</p>
      </ConfirmDialog>
    </Card>
  );
}

// その SNS に届く画像（と画像の説明）・動画。どれが届くかは送信ジョブと同じ決まり（mediaForSns）
function TargetMedia({ sns, media }: { sns: SnsKey; media: ReviewMedia }) {
  const m = mediaForSns(sns, media);
  if (m.kind === "none") return null;
  const label = SNS[sns].label;
  if (m.kind === "video") {
    return (
      <div className="flex flex-col gap-1.5">
        {m.video.url ? (
          <video src={m.video.url} controls playsInline preload="metadata" aria-label={`${label} に添える動画`} className="max-h-[320px] w-full rounded-md bg-surface2 object-contain" />
        ) : (
          <p className="text-sm text-muted">動画を読み込めませんでした。読み込み直してください。</p>
        )}
        <p className="num text-xs text-muted">動画 {formatDuration(m.video.durationMs)}</p>
        {m.unsupported && (
          <p className="text-sm">
            <span className="text-signal">●</span> {label} には、yabumi からはまだ動画を送れません。編集の画面で動画を外すか、{label} を送り先から外してください。
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-4 gap-2 max-sm:grid-cols-2" aria-label={`${label} に添える画像`}>
        {m.images.map((image, i) => (
          <li key={image.id} className="flex flex-col gap-1">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-line bg-surface2">
              {image.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- 署名つきの URL は期限があり、next/image の最適化を通さない
                <img src={image.url} alt={image.altText || `${i + 1} 枚目の画像`} className="size-full object-contain" />
              ) : (
                <span className="px-2 text-center text-xs text-muted">読み込めませんでした</span>
              )}
            </div>
            <p className="text-xs leading-[1.6] break-words text-muted">{image.altText ? `画像の説明: ${image.altText}` : "画像の説明なし"}</p>
          </li>
        ))}
      </ul>
      {m.overLimit && (
        <p className="text-sm">
          <span className="text-signal">●</span> {label} に添えられる画像は {m.max} 枚までです。編集の画面で画像を減らしてください（このままでは送れません）。
        </p>
      )}
    </div>
  );
}
