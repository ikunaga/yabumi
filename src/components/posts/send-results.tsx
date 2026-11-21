"use client";

import Link from "next/link";
import { callAction } from "@/lib/client-errors";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isProcessing, RESULT_POLL_MAX, RESULT_POLL_MS } from "@/lib/posts/send-mode";
import { Button, buttonClass } from "@/components/ui/button";
import { deleteFromSns, markManualPosted, markRemovedOnSns } from "@/lib/posts/send-actions";
import { SNS, SNS_KEYS, isManualSns, type SnsKey } from "@/lib/sns";
import { formatShort } from "@/lib/time";

export type TargetResult = {
  id: string;
  status: "pending" | "awaiting_approval" | "preparing" | "publishing" | "published" | "failed" | "deleted";
  externalUrl: string | null;
  errorMessage: string | null;
  publishedAt: string | null;
  nextAttemptAt: string | null;
  // 手で投稿する SNS 用: 保存してあるタイトルと本文、投稿の画面の URL
  manual?: ManualInfo;
  // 自動で送れなかった・手で投稿すると選んだ X・TikTok・YouTube を、手で投稿して記録するための情報
  fallback?: ManualInfo;
  // 引用の X（manual に X の投稿の画面の URL が入る。X の画面で送って記録する。4.52）
  quote?: boolean;
  // 利用者が「X・TikTok・YouTube は手で投稿する」を選んだもの（失敗ではないので「手で投稿」と出す）
  byHand?: boolean;
  // 手で投稿して記録したもの（SNS 上の投稿の ID がないので、yabumi からは取り消せない）
  postedByHand?: boolean;
  // TikTok を下書き（受信箱。MEDIA_UPLOAD）として送った。札を「TikTok の下書きに送信済み」にする（2026-11-21）
  tiktokDraft?: boolean;
  // yabumi の外（SNS の画面など）で消されていた。yabumi から取り消したときは false
  removedOnSns?: boolean;
};

// downloads: 画像・動画を保存する URL（TikTok・YouTube に手で投稿するとき。保存してアプリや YouTube Studio で選ぶ）
type ManualInfo = { title: string | null; text: string; composeUrl: string | null; downloads?: { url: string; name: string }[] };

// 送信の結果: 送れたものは SNS 上の投稿へのリンクと取り消し、送れなかったものは理由と「要確認」
// video: 動画の投稿（準備中の文を動画のものにする。docs/design/video.md の 5.）
export function SendResults({ projectId, postId, results, video = false }: { projectId: string; postId: string; results: Partial<Record<SnsKey, TargetResult>>; video?: boolean }) {
  const rows = SNS_KEYS.flatMap((sns) => {
    const r = results[sns];
    if (!r) return [];
    // 手で投稿する SNS は、投稿するまでの手順をいつも出す
    if ((isManualSns(sns) || r.quote) && r.manual) return [{ sns, r }];
    if (r.status === "pending" && !r.errorMessage) return [];
    return [{ sns, r }];
  });
  const processing = rows.some(({ r }) => isProcessing(r.status));
  const pollEnded = useResultPolling(processing);
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="send-results-heading" className="overflow-hidden rounded-lg border border-border bg-surface">
      <h2 id="send-results-heading" className="border-b border-line px-5 py-3 text-[14px] font-bold max-sm:px-4">
        送信の結果
      </h2>
      <ul className="divide-y divide-line text-sm">
        {rows.map(({ sns, r }) =>
          (isManualSns(sns) || r.quote) && r.manual ? (
            <ManualRow key={sns} sns={sns} r={r} projectId={projectId} postId={postId} />
          ) : (
            <ResultRow key={sns} sns={sns} r={r} projectId={projectId} postId={postId} video={video} />
          ),
        )}
      </ul>
      {processing && pollEnded && (
        <p role="status" className="border-t border-line px-5 py-2.5 text-[13px] text-muted max-sm:px-4">
          まだ処理しています。少しして、画面を読み込み直してください。
        </p>
      )}
    </section>
  );
}

// SNS の側で処理している配信先があるあいだ、送信の結果を決まった間隔で読み直す（回数に上限。画面が隠れているあいだは数えない）。
// 上限まで読み直したら true（「読み込み直して」と出す）
function useResultPolling(active: boolean): boolean {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const ended = count >= RESULT_POLL_MAX;
  useEffect(() => {
    if (!active || ended) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setCount((n) => n + 1);
    }, RESULT_POLL_MS);
    return () => clearInterval(timer);
  }, [active, ended, router]);
  return ended;
}

function ResultRow({ sns, r, projectId, postId, video }: { sns: SnsKey; r: TargetResult; projectId: string; postId: string; video: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = SNS[sns].label;

  return (
    <li className="flex flex-col gap-1 px-5 py-2.5 leading-[1.6]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b>{label}</b>
        {r.status === "published" && (
          <>
            {/* TikTok の下書き（受信箱）と、TikTok の確かめが済む前の公開の投稿は、投稿の URL がない（docs/design/tiktok.md の 6. と 8.） */}
            <span className="text-muted">
              {sns === "tiktok" && !r.externalUrl && !r.postedByHand
                ? r.tiktokDraft
                  ? r.publishedAt
                    ? `${formatShort(r.publishedAt)} に TikTok の下書きへ送信`
                    : "TikTok の下書きに送信済み"
                  : r.publishedAt
                    ? `${formatShort(r.publishedAt)} に送信`
                    : "送信済み"
                : r.publishedAt
                  ? `${formatShort(r.publishedAt)} に投稿`
                  : "送信済み"}
            </span>
            {r.externalUrl && (
              <a href={r.externalUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                {label} で見る
              </a>
            )}
            {r.postedByHand ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">手動で投稿</span>
            ) : sns === "tiktok" ? (
              // TikTok の API では投稿を消せない。受信箱に送った下書きは、利用者が TikTok のアプリで仕上げる
              <span className="ml-auto text-xs text-muted">
                {r.externalUrl ? "取り消すときは、TikTok のアプリから" : "TikTok のアプリの受信箱に届いていれば、通知から開いて仕上げてください。取り消すときは TikTok のアプリから"}
              </span>
            ) : sns === "youtube" ? (
              // YouTube は yabumi から取り消さない（youtube.upload では消せない。2026-11-15 オーナーの決定 Y5）
              <a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-muted underline hover:text-fg">
                取り消すときは、YouTube Studio から
              </a>
            ) : sns === "instagram" ? (
              // Instagram Login では、API で投稿を消せない（docs/architecture.md の 4.21）
              <span className="ml-auto text-xs text-muted">取り消すときは、Instagram のアプリで投稿の「…」→「削除」</span>
            ) : (
            <span className="ml-auto">
              {confirm ? (
                <span className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null);
                        const out = await callAction(() => deleteFromSns(projectId, postId, r.id));
                        // 成功したらサーバーで画面を読み直すので、ここに来るのは失敗したときだけ
                        const message = out.ok ? out.value?.error : out.failure.message;
                        if (message) setError(message);
                        setConfirm(false);
                      })
                    }
                  >
                    本当に {label} から取り消す
                  </Button>
                  <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => setConfirm(false)}>
                    やめる
                  </Button>
                </span>
              ) : (
                <Button type="button" variant="text" size="sm" onClick={() => setConfirm(true)}>
                  {label} から取り消す
                </Button>
              )}
            </span>
            )}
          </>
        )}
        {r.status === "publishing" && <span className="text-muted">送信中です。しばらくしてから読み込み直してください。</span>}
        {r.status === "awaiting_approval" && (
          // 自動の投稿の「確かめて送る」SNS（X など）。確かめる画面で中身を見て承認すると送る（docs/design/auto-post.md の 1.6）
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-bold text-signal">確認待ち。確認すると送ります</span>
            <Link href={`/projects/${projectId}/auto/review`} className="text-sm font-bold text-fg underline">
              確認する →
            </Link>
          </span>
        )}
        {r.status === "preparing" &&
          (sns === "tiktok" ? (
            // TikTok は、送ったあとに TikTok の側で写真を取りに来て処理する（docs/design/tiktok.md の 6.）
            <span className="text-muted">TikTok で処理しています（数分かかることがあります。結果が出ると、この画面も変わります）</span>
          ) : sns === "youtube" ? (
            // YouTube は、動画を何回かに分けて送る（docs/design/youtube.md の 3.）
            <span className="text-muted">YouTube に動画を上げています（数分かかることがあります。結果が出ると、この画面も変わります）</span>
          ) : (
            <span className="text-muted">
              {video
                ? `${label} が動画を処理しています。準備ができしだい送ります（数分かかることがあります。結果が出ると、この画面も変わります）`
                : `${label} が画像を処理しています。準備ができしだい送ります（1〜2 分ほど。結果が出ると、この画面も変わります）`}
            </span>
          ))}
        {r.status === "deleted" &&
          (r.removedOnSns ? (
            <span className="text-muted">{label} で消されていました。消えた投稿へのリンクは、yabumi からも消しました（yabumi の下書きは残っています）</span>
          ) : (
            <span className="text-muted">{label} から取り消しました（yabumi の下書きは残っています）</span>
          ))}
        {r.status === "failed" && r.byHand && <span className="font-bold text-signal">手動で投稿する番</span>}
        {r.status === "failed" && !r.byHand && (
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
      {r.status === "failed" && !r.byHand && <p className="text-xs text-muted">直してから「今すぐ送る」か「予約」で送り直せます。</p>}
      {r.status === "published" && (
        <RemovedOnSns label={label} onConfirm={() => markRemovedOnSns(projectId, postId, r.id)} />
      )}
      {r.status === "failed" && r.fallback && !showManual && (
        <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setShowManual(true)}>
          {label} に手動で投稿する
        </Button>
      )}
      {r.status === "failed" && r.fallback && showManual && (
        <ManualSteps sns={sns} info={r.fallback} targetId={r.id} projectId={projectId} postId={postId} />
      )}
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

// SNS の画面で投稿を消したときに、yabumi の記録からも消す（消えた投稿の ID と URL を残さない）
function RemovedOnSns({ label, onConfirm }: { label: string; onConfirm: () => Promise<{ error?: string } | undefined> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!open) {
    return (
      // 説明（いつ使うか）と、押すもの（記録する）を分けて、押せるものだとひと目でわかるようにする（2026-11-10 PM の指摘）
      <p className="text-xs text-muted">
        {label} の画面で消したときは{" "}
        <button type="button" onClick={() => setOpen(true)} className="font-semibold text-fg underline underline-offset-2 hover:text-primary">
          ここで記録する
        </button>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted">
      <p>{label} で消した投稿は、yabumi の記録からもリンクを消します（{label} には何もしません）。</p>
      <span className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await onConfirm();
              if (res?.error) setError(res.error);
            })
          }
        >
          {label} で消したと記録する
        </Button>
        <Button type="button" variant="text" size="sm" onClick={() => setOpen(false)}>
          やめる
        </Button>
      </span>
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// 手で投稿する SNS（note・Substack）: 本文をコピー → 投稿の画面を開く → 投稿したら「投稿した」で記録
function ManualRow({ sns, r, projectId, postId }: { sns: SnsKey; r: TargetResult; projectId: string; postId: string }) {
  const label = SNS[sns].label;

  if (r.status === "published") {
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 leading-[1.6]">
        <b>{label}</b>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">手動で投稿</span>
        <span className="font-bold text-success">✓ 送信済み</span>
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
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">手動で投稿</span>
        <span className="text-muted">
          {r.quote ? "X の仕組みで、引用は yabumi から予約できません。X の画面で送ってください" : `${label} には公式の投稿のしくみがないので、ここから手動で投稿します`}
        </span>
      </div>
      <ManualSteps sns={sns} info={r.manual!} targetId={r.id} projectId={projectId} postId={postId} quote={r.quote} />
    </li>
  );
}

// 手で投稿する手順。note・Substack のほか、自動で送れなかった X でも使う
function ManualSteps({
  sns,
  info: m,
  targetId,
  projectId,
  postId,
  quote = false,
}: {
  sns: SnsKey;
  info: ManualInfo;
  targetId: string;
  projectId: string;
  postId: string;
  quote?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState<"title" | "body" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = SNS[sns].label;
  // X は投稿の画面に本文を入れた状態で開けるので、コピーは控えめにする
  const unit = sns === "x" || sns === "tiktok" ? "投稿" : sns === "youtube" ? "動画" : "記事";
  // TikTok は「画像を保存」、YouTube は「動画を保存」を先に置くので、番号を 1 つずらす
  const tiktok = sns === "tiktok";
  const youtube = sns === "youtube";
  const n = (i: number) => (tiktok || youtube ? i + 1 : i);

  async function copy(kind: "title" | "body", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("コピーできませんでした。本文を選んでコピーしてください。");
    }
  }

  return (
    <>
      <ol className="flex flex-col gap-2 text-sm">
        {tiktok && (
          <li className="flex flex-col gap-1.5">
            <span>
              <span className="text-muted">1.</span> 画像を保存します（スマホは画像を長押しするか「保存」、PC は「保存」でダウンロード）
            </span>
            {m.downloads?.length ? (
              <div className="flex flex-wrap gap-2">
                {m.downloads.map((d, i) => (
                  <div key={d.url} className="flex flex-col items-center gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 添えた画像の署名つき URL（1 時間で切れる） */}
                    <img src={d.url} alt={`画像 ${i + 1}`} className="size-20 rounded-md border border-line object-cover" />
                    <a href={d.url} download={d.name} className={buttonClass({ variant: "secondary", size: "sm" })}>
                      保存
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted">この投稿には画像がありません。TikTok の写真の投稿には画像が要ります。</span>
            )}
          </li>
        )}
        {youtube && (
          <li className="flex flex-col gap-1.5">
            <span>
              <span className="text-muted">1.</span> 動画を保存します
            </span>
            {m.downloads?.length ? (
              <div className="flex flex-wrap gap-2">
                {m.downloads.map((d) => (
                  <a key={d.url} href={d.url} download={d.name} className={buttonClass({ variant: "secondary", size: "sm" })}>
                    動画を保存
                  </a>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted">この投稿には動画がありません。YouTube には動画が要ります。</span>
            )}
          </li>
        )}
        <li className="flex flex-wrap items-center gap-2">
          <span className="text-muted">{n(1)}.</span>
          {m.title && (
            <Button type="button" variant="secondary" size="sm" onClick={() => copy("title", m.title!)}>
              {copied === "title" ? "コピーしました" : "タイトルをコピー"}
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => copy("body", m.text)}>
            {copied === "body" ? "コピーしました" : "本文をコピー"}
          </Button>
        </li>
        {tiktok ? (
          // 長い 1 文なので、番号と文を 1 つの文にして折り返す（ほかの番号と同じ形。スマホで番号だけが別の行にならないように）
          <li>
            <span className="text-muted">{n(2)}.</span> スマホの TikTok のアプリを開き、＋ から保存した写真を選んで、タイトルと本文を貼り付けて投稿する
          </li>
        ) : (
          <li className="flex flex-wrap items-center gap-2">
            <span className="text-muted">{n(2)}.</span>
            {m.composeUrl ? (
              <a href={m.composeUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                {youtube ? "YouTube Studio を開く" : `${label} の投稿の画面を開く`}
              </a>
            ) : (
              <span className="text-muted">{label} を開いて、新しい記事を作る</span>
            )}
            <span className="text-xs text-muted">
              {sns === "x" ? (quote ? "（本文と引用する投稿が入った状態で開きます）" : "（本文が入った状態で開きます）") : youtube ? "（「作成」→「動画をアップロード」で保存した動画を選び、タイトルと説明を貼り付けます）" : "（貼り付けて投稿します）"}
            </span>
          </li>
        )}
        <li className="flex flex-col gap-1.5">
          <span>
            <span className="text-muted">{n(3)}.</span> 投稿したら、記録します。投稿の URL は任意です
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={`${label} の${unit}の URL（https://…）`}
              aria-label={`${label} の${unit}の URL`}
              className="min-w-0 flex-1 rounded-md border border-input bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
            />
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await markManualPosted(projectId, postId, targetId, url);
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
    </>
  );
}
