"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { deletePost, savePost } from "@/lib/posts/actions";
import type { SavePostResult } from "@/lib/posts/schema";
import { PlanHints, type PlanHintsData } from "./plan-hints";
import { SendResults, type TargetResult } from "./send-results";
import { ISSUE_LABEL, MAX_TITLE_LENGTH, SNS, SNS_KEYS, checkTarget, isManualSns, type SnsKey, type TargetIssue } from "@/lib/sns";

export type ComposerInitial = {
  body: string;
  targets: { sns: SnsKey; bodyOverride: string | null; title?: string | null }[];
  plannedAt: string;
};

type Props = {
  projectId: string;
  projectName: string;
  postId: string | null;
  initial: ComposerInitial;
  // つないでいて、送信もできる SNS
  connected: SnsKey[];
  // 配信先ごとの送信の状態（新しい投稿では空）
  results?: Partial<Record<SnsKey, TargetResult>>;
  notice?: string;
  noticeTone?: "success" | "error";
  // アカウント設計の投稿の柱と口調（書くときの手がかり）
  planHints?: PlanHintsData | null;
};

// 送信済み・送信中・取り消し済みの配信先は、選び直しも送り直しもできない
const LOCKED = new Set(["published", "publishing", "deleted"]);

const ISSUE_TONE: Record<TargetIssue, string> = {
  empty: "text-signal",
  too_long: "text-danger",
  needs_image: "text-signal",
  needs_video: "text-signal",
  needs_title: "text-signal",
};

function formatCount(n: number) {
  return n.toLocaleString("ja-JP");
}

export function PostComposer({
  projectId,
  projectName,
  postId,
  initial,
  connected,
  results = {},
  notice,
  noticeTone = "success",
  planHints = null,
}: Props) {
  const [body, setBody] = useState(initial.body);
  const [selected, setSelected] = useState<Set<SnsKey>>(() => new Set(initial.targets.map((t) => t.sns)));
  const [overrides, setOverrides] = useState<Partial<Record<SnsKey, string>>>(() =>
    Object.fromEntries(initial.targets.filter((t) => t.bodyOverride !== null).map((t) => [t.sns, t.bodyOverride!])),
  );
  // 最初に見せる SNS: 文面を変えた SNS があればそれ、なければ並び順で最初に選ばれているもの
  const [focus, setFocus] = useState<SnsKey>(
    () =>
      initial.targets.find((t) => t.bodyOverride !== null)?.sns ??
      SNS_KEYS.find((s) => initial.targets.some((t) => t.sns === s)) ??
      "x",
  );
  // 長文の SNS（note・Substack）のタイトル
  const [titles, setTitles] = useState<Partial<Record<SnsKey, string>>>(() =>
    Object.fromEntries(initial.targets.filter((t) => t.title).map((t) => [t.sns, t.title!])),
  );
  const [plannedAt, setPlannedAt] = useState(initial.plannedAt);
  const [result, setResult] = useState<SavePostResult>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [pending, startTransition] = useTransition();

  const textFor = (sns: SnsKey) => overrides[sns] ?? body;
  const checks = useMemo(
    () =>
      Object.fromEntries(SNS_KEYS.map((sns) => [sns, checkTarget(sns, overrides[sns] ?? body, undefined, titles[sns] ?? null)])) as Record<
        SnsKey,
        ReturnType<typeof checkTarget>
      >,
    [body, overrides, titles],
  );

  const isLocked = (s: SnsKey) => LOCKED.has(results[s]?.status ?? "");
  const chosen = SNS_KEYS.filter((s) => selected.has(s));
  // これから送る SNS（送信済みなどを除く）
  const toSend = chosen.filter((s) => !isLocked(s));
  // 送れない理由（最初の 1 つ）。日時は予約のときだけ要る
  const sendBlocker = (() => {
    if (chosen.length === 0) return "送り先の SNS を選んでください";
    if (toSend.length === 0) return "選んだ SNS にはすべて送信済みです";
    for (const s of toSend) {
      const issue = checks[s].issues[0];
      if (issue) return `${SNS[s].label}: ${ISSUE_LABEL[issue]}`;
    }
    // 手で投稿する SNS は、つながなくてよい
    const missing = toSend.filter((s) => !isManualSns(s) && !connected.includes(s));
    if (missing.length) return `${missing.map((s) => SNS[s].label).join("・")} をつなぐと送れます`;
    return null;
  })();
  const blocker = sendBlocker ?? (plannedAt ? null : "送る日時を決めてください");
  // 今すぐ送れるのは、自動で送る SNS だけ
  const nowBlocker =
    sendBlocker ?? (toSend.some((s) => !isManualSns(s)) ? null : "note・Substack は手で投稿します。予約か下書き保存をすると、投稿の画面から手で投稿できます");

  // 直し始めたら、その欄のエラーは消す
  function clearFieldError(key: keyof NonNullable<SavePostResult["fieldErrors"]>) {
    setResult((r) => (r.fieldErrors?.[key] ? { ...r, fieldErrors: { ...r.fieldErrors, [key]: undefined } } : r));
  }

  function toggle(sns: SnsKey) {
    if (isLocked(sns)) return;
    clearFieldError("targets");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sns)) next.delete(sns);
      else next.add(sns);
      return next;
    });
    setFocus(sns);
  }

  function submit(intent: "draft" | "schedule" | "now") {
    setResult({});
    setConfirmSend(false);
    startTransition(async () => {
      const res = await savePost({
        projectId,
        postId,
        body,
        plannedAt,
        intent,
        targets: chosen.map((sns) => ({ sns, bodyOverride: overrides[sns] ?? null, title: SNS[sns].needsTitle ? (titles[sns] ?? null) : null })),
      });
      // 成功時はサーバーで画面を移るので、ここに来るのは失敗したときだけ
      if (res) setResult(res);
    });
  }

  const fe = result.fieldErrors ?? {};
  const focusLabel = SNS[focus].label;
  const hasOverride = overrides[focus] !== undefined;

  return (
    <div className="flex min-h-full flex-col">
      <div className="grid flex-1 grid-cols-[1fr_440px] gap-7 max-xl:grid-cols-1">
        {/* 左: 下書き */}
        <section aria-labelledby="draft-heading" className="flex flex-col gap-3.5">
          <div className="flex items-baseline justify-between gap-4">
            <h1 id="draft-heading" className="font-heading text-2xl font-bold">
              下書き
            </h1>
            <span className="text-sm font-semibold text-primary opacity-55" title="フェーズ 2 で使えるようになります">
              AI に案を出してもらう（準備中）
            </span>
          </div>

          {notice && (noticeTone === "error" ? <ErrorBanner>{notice}</ErrorBanner> : <SuccessBanner>{notice}</SuccessBanner>)}
          {result.error && <ErrorBanner>{result.error}</ErrorBanner>}

          <label htmlFor="post-body" className="sr-only">
            本文
          </label>
          <textarea
            id="post-body"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              clearFieldError("body");
            }}
            placeholder="伝えたいことを書きます。SNS ごとの調整は右の欄で。"
            aria-invalid={fe.body ? true : undefined}
            className={`bg-ruled h-[260px] w-full resize-y rounded-lg border bg-surface px-5 py-4 text-[16px] leading-8 text-fg outline-none [background-position:0_16px] placeholder:text-muted ${fe.body ? "border-danger shadow-[0_0_0_1px_var(--danger)]" : "border-border focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)]"}`}
          />
          <div className="flex items-center gap-3 text-sm text-muted">
            <span>{formatCount([...body].length)} 字</span>
            {fe.body && <span className="font-semibold text-danger">{fe.body}</span>}
          </div>

          <PlanHints projectId={projectId} hints={planHints} />

          <div
            className="flex h-[140px] items-center justify-center rounded-lg border-[1.5px] border-dashed border-border text-sm text-muted"
            style={{ background: "repeating-linear-gradient(45deg, transparent 0 10px, var(--rule) 10px 11px)" }}
          >
            画像・動画をここに置く（準備中）
          </div>
        </section>

        {/* 右: 送り先と文面の調整 */}
        <section aria-labelledby="targets-heading" className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
          <h2 id="targets-heading" className="border-b-2 border-primary px-5 py-3 text-[14px] font-bold">
            送り先と文面の調整
          </h2>
          {fe.targets && (
            <p role="alert" className="border-b border-line bg-danger-soft px-5 py-2.5 text-sm font-semibold text-danger">
              {fe.targets}
            </p>
          )}
          <ul className="text-sm">
            {SNS_KEYS.map((sns) => {
              const on = selected.has(sns);
              const check = checks[sns];
              const issue = check.issues[0];
              const isFocus = focus === sns;
              const spec = SNS[sns];
              const sent = results[sns];
              return (
                <li
                  key={sns}
                  className={`grid grid-cols-[1fr_auto_auto] items-center border-b border-line ${isFocus ? "bg-primary-soft" : ""}`}
                >
                  <label className={`flex cursor-pointer items-center gap-2 py-[11px] pl-5 ${on ? "font-bold" : "text-muted"} ${isFocus ? "text-primary" : ""}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={isLocked(sns)}
                      onChange={() => toggle(sns)}
                      className="size-4 accent-[var(--primary)]"
                    />
                    {spec.label}
                  </label>
                  <button
                    type="button"
                    onClick={() => setFocus(sns)}
                    className="px-3 py-[11px] text-right text-muted hover:underline"
                    aria-label={`${spec.label} での見え方を表示`}
                  >
                    {on ? (check.maxLength ? `${formatCount(check.length)} / ${formatCount(check.maxLength)}` : formatCount(check.length)) : "—"}
                  </button>
                  <span className="min-w-[96px] py-[11px] pr-5 text-right">
                    {on && sent && sent.status !== "pending" ? (
                      <TargetStateMark status={sent.status} />
                    ) : on && sent?.status === "pending" && sent.errorMessage ? (
                      <span className="font-bold text-signal">送り直し待ち</span>
                    ) : !on && isManualSns(sns) ? (
                      <ManualMark />
                    ) : !on ? (
                      <span className="text-muted">{spec.media === "video" ? "動画が必要" : spec.media === "image_or_video" ? "画像が必要" : ""}</span>
                    ) : issue ? (
                      <span className={`font-bold ${ISSUE_TONE[issue]}`}>{ISSUE_LABEL[issue]}</span>
                    ) : isManualSns(sns) ? (
                      <ManualMark />
                    ) : connected.includes(sns) ? (
                      <span className="font-bold text-success">OK</span>
                    ) : (
                      <span className="font-bold text-signal">未接続</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {postId && <SendResults projectId={projectId} postId={postId} results={results} />}

          <div className="flex flex-1 flex-col gap-2.5 bg-surface2 px-5 py-4">
            <p className="text-xs text-muted">
              {focusLabel} での見え方
              {isManualSns(focus) && <span className="ml-2">・この SNS には、投稿の画面から手で投稿します</span>}
            </p>
            {SNS[focus].needsTitle && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="target-title" className="text-xs font-bold">
                  {focusLabel} のタイトル
                </label>
                <input
                  id="target-title"
                  value={titles[focus] ?? ""}
                  maxLength={MAX_TITLE_LENGTH}
                  onChange={(e) => setTitles((t) => ({ ...t, [focus]: e.target.value }))}
                  placeholder="例: 個人開発で家計簿アプリを 3 か月作って気づいたこと"
                  className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
                />
              </div>
            )}
            <div className="flex gap-2.5 rounded-lg border border-border bg-surface p-3.5">
              <span aria-hidden className="size-9 flex-none rounded-full bg-primary-soft" />
              <div className="flex min-w-0 flex-col gap-1 text-sm leading-[1.6]">
                <b>{SNS[focus].needsTitle && titles[focus] ? titles[focus] : projectName}</b>
                <span className="line-clamp-6 break-words whitespace-pre-wrap">{textFor(focus) || <span className="text-muted">（本文なし）</span>}</span>
              </div>
            </div>
            {hasOverride ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="override" className="text-xs font-bold">
                  {focusLabel} 用の文面
                </label>
                <textarea
                  id="override"
                  rows={SNS[focus].needsTitle ? 12 : 4}
                  value={overrides[focus]}
                  onChange={(e) => setOverrides((o) => ({ ...o, [focus]: e.target.value }))}
                  className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)]"
                />
                <button
                  type="button"
                  onClick={() =>
                    setOverrides((o) => {
                      const next = { ...o };
                      delete next[focus];
                      return next;
                    })
                  }
                  className="self-start text-xs font-semibold text-primary hover:underline"
                >
                  共通の文面に戻す
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setOverrides((o) => ({ ...o, [focus]: body }))}
                className="self-start text-xs font-semibold text-primary hover:underline"
              >
                {focusLabel} 用に文面を変える
              </button>
            )}
          </div>
        </section>
      </div>

      {/* 下: 送る日時と保存 */}
      <div className="sticky bottom-0 z-[5] -mx-12 mt-7 flex flex-wrap items-center gap-4 border-t border-border bg-surface px-12 py-3.5 max-lg:-mx-8 max-lg:px-8 max-sm:bottom-[72px] max-sm:-mx-4 max-sm:gap-3 max-sm:px-4">
        <label htmlFor="planned-at" className="text-[14px] text-muted">
          送る日時
        </label>
        <input
          id="planned-at"
          type="datetime-local"
          value={plannedAt}
          onChange={(e) => {
            setPlannedAt(e.target.value);
            clearFieldError("plannedAt");
          }}
          aria-invalid={fe.plannedAt ? true : undefined}
          className={`rounded-md border bg-surface px-3.5 py-2 text-[14px] text-fg outline-none max-sm:text-[16px] ${fe.plannedAt ? "border-danger shadow-[0_0_0_1px_var(--danger)]" : "border-input focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)]"}`}
        />
        <span className={`text-xs ${fe.plannedAt ? "font-semibold text-danger" : "text-muted"}`}>
          {fe.plannedAt ?? blocker ?? "予約すると、この日時に自動で送ります"}
        </span>
        {/* 今すぐ送るは取り消しにくいので、押したら確かめる */}
        <div className="ml-auto flex flex-wrap items-center gap-3 max-sm:ml-0 max-sm:w-full">
          {postId &&
            (confirmDelete ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => startTransition(() => deletePost(projectId, postId))}
              >
                本当に削除する
              </Button>
            ) : (
              <Button type="button" variant="text" size="sm" onClick={() => setConfirmDelete(true)}>
                削除
              </Button>
            ))}
          <Button type="button" variant="secondary" disabled={pending} onClick={() => submit("draft")} className="max-sm:flex-1">
            下書き保存
          </Button>
          {confirmSend ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={() => submit("now")} className="max-sm:flex-1">
              本当に今すぐ送る
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={pending || nowBlocker !== null}
              title={nowBlocker ?? undefined}
              onClick={() => setConfirmSend(true)}
              className="max-sm:flex-1"
            >
              今すぐ送る
            </Button>
          )}
          <Button
            type="button"
            disabled={pending || blocker !== null}
            onClick={() => submit("schedule")}
            className="max-sm:flex-1"
          >
            {toSend.length > 0 ? `${toSend.length} つの SNS に予約する` : "予約する"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TargetStateMark({ status }: { status: TargetResult["status"] }) {
  switch (status) {
    case "published":
      return <span className="font-bold text-success">✓ 送信済み</span>;
    case "publishing":
      return <span className="text-muted">送信中</span>;
    case "deleted":
      return <span className="text-muted">取り消し済み</span>;
    case "failed":
      return <span className="font-bold text-danger">! 失敗</span>;
    default:
      return null;
  }
}

// 手で投稿する SNS の印（自動の SNS と区別する。朱は使わない）
function ManualMark() {
  return <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">手で投稿</span>;
}
