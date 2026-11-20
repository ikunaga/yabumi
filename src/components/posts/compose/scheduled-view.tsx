"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { VideoBox } from "../video-attachment";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { SnsTag } from "@/components/ui/marks";
import { tabClass, tabListClass } from "@/components/ui/tabs";
import { skipScheduledAutoRun } from "@/lib/auto-post/actions";
import { dayWithWeekday, scheduledSentence } from "@/lib/posts/send-mode";
import { isManualSns, SNS, type SnsKey } from "@/lib/sns";
import { callAction } from "@/lib/client-errors";
import { SnsPreview } from "../sns-preview";
import { type Composer } from "./use-composer";

// 予約済み・確認待ちの投稿の詳細（2026-11-21 オーナーの指摘「予約した投稿を後で確認するとき、投稿をつくるときの『送る』の画面と同じになっている」）。
// 送った投稿の画面（sent-view.tsx）と同じく、手順（1〜5）は出さずに、いつ・どこに送るか・SNS ごとの状態・中身を読むだけにする。
// 操作はボタンで: 内容を編集する（このときだけ投稿をつくるの画面）・予約の日時を変える（ここで）・この日の投稿を飛ばす（自動の投稿のとき）・
// 予約をやめて下書きに戻す（手で予約した投稿のとき）・確認する（確認待ちのとき）
export function ComposeScheduledView({ c }: { c: Composer }) {
  const { projectId, chosen, toSend, shownText, titles, projectName, accountNames, images, video, initial, postId, checks, results, plannedAt, setPlannedAt, askSchedule, submit, pending, busy, scheduleAsked, blocker, fe, deleteRow, goStep, autoRun } = c;
  const router = useRouter();
  const [tab, setTab] = useState<SnsKey | null>(null);
  const [changing, setChanging] = useState(false);
  const [skipAsk, setSkipAsk] = useState(false);
  const [skipping, startSkip] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const review = autoRun?.status === "review";
  const awaiting = toSend.filter((s) => review || results[s]?.status === "awaiting_approval");
  const names = toSend.map((s) => SNS[s].label);
  const savedAt = initial.plannedAt ?? "";
  const focus = tab && chosen.includes(tab) ? tab : chosen[0];
  const reviewHref = `/projects/${projectId}/auto/review`;
  const canSkip = !!autoRun && (autoRun.status === "scheduled" || autoRun.status === "review");

  const stateOf = (s: SnsKey) =>
    awaiting.includes(s) ? { text: "確認すると送ります", tone: "font-bold text-signal" } : isManualSns(s) ? { text: "この SNS には、自分で投稿します", tone: "text-muted" } : { text: "予約済み", tone: "font-bold text-success" };
  // 確認が要る SNS があるときは、「予約済み」と言い切らない（確認しないと送らないため）
  const sentence = awaiting.length > 0 ? scheduledSentence(savedAt, names).replace("予約済みです。", "送る予定です。") : scheduledSentence(savedAt, names);

  function skip() {
    if (!autoRun) return;
    setError(null);
    startSkip(async () => {
      const out = await callAction(() => skipScheduledAutoRun(autoRun.runId));
      const message = out.ok ? (out.value.ok ? null : out.value.error) : out.failure.message;
      if (message) {
        setError(message);
        setSkipAsk(false);
        return;
      }
      router.replace(`/projects/${projectId}/posts/${postId}?done=skipped`);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="scheduled-heading" className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
      <h2 id="scheduled-heading" className="text-[18px] font-bold max-sm:text-[16px]">
        {review ? "まだ確認していません" : "予約済み"}
      </h2>
      <div className="flex flex-col gap-1.5 text-[15px] leading-[1.7]">
        {review ? (
          <>
            <p>{sentence}</p>
            <p>1 回目の投稿は、「確認する」を押すまで送りません。</p>
          </>
        ) : (
          <p className="font-bold">{sentence}</p>
        )}
        {!review && awaiting.length > 0 && <p>{awaiting.map((s) => SNS[s].label).join("・")} は、「確認する」を押すまで送りません。</p>}
        {autoRun && (
          <p className="text-muted">
            自動投稿「{autoRun.planName}」で {dayWithWeekday(savedAt.slice(0, 10)).replace(/（.）$/, "")} に送る投稿です。
          </p>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
        {chosen.map((s) => {
          const st = stateOf(s);
          return (
            <li key={s} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <SnsTag sns={s} />
              <span className={`text-[14px] ${st.tone}`}>{st.text}</span>
              {awaiting.includes(s) && (
                <Link href={reviewHref} className="ml-auto text-sm font-bold underline">
                  確認する →
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {chosen.length > 1 && (
        <div role="tablist" aria-label="SNS ごとの見え方" className={tabListClass}>
          {chosen.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={focus === s} onClick={() => setTab(s)} className={tabClass(focus === s)}>
              {SNS[s].label}
            </button>
          ))}
        </div>
      )}
      {focus && (
        <div role={chosen.length > 1 ? "tabpanel" : undefined}>
          <SnsPreview key={focus} sns={focus} text={shownText(focus)} title={titles[focus] ?? null} projectName={projectName} account={accountNames[focus] ?? null} images={images} length={checks[focus].length} />
        </div>
      )}
      {video && (
        <div className="w-[88px] max-sm:w-[64px]">
          <VideoBox video={video} postId={postId ?? undefined} />
        </div>
      )}

      {/* 予約の日時を変える（ここで日時だけを変える。中身は変えない） */}
      {changing && !review && (
        <div className="flex flex-col gap-2 rounded-md border border-line px-4 py-3">
          <label htmlFor="scheduled-at" className="text-[14px] font-bold">
            新しい日時
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="scheduled-at"
              type="datetime-local"
              value={plannedAt}
              onChange={(e) => setPlannedAt(e.target.value)}
              aria-invalid={fe.plannedAt ? true : undefined}
              className={`num h-9 rounded-md border bg-surface px-3 text-[14px] text-fg outline-none max-sm:text-[16px] ${fe.plannedAt ? "border-danger" : "border-border focus:border-primary"}`}
            />
            <span className="text-[14px] text-muted">日本時間</span>
          </div>
          {(fe.plannedAt || blocker) && <p className="text-[13px] text-signal">{fe.plannedAt ?? blocker}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending || scheduleAsked || !plannedAt || plannedAt === savedAt || blocker !== null} onClick={askSchedule}>
              {busy === "schedule" || scheduleAsked ? "変更しています…" : "この日時に変更する"}
            </Button>
            <Button
              type="button"
              variant="text"
              size="sm"
              disabled={pending}
              onClick={() => {
                setPlannedAt(savedAt);
                setChanging(false);
              }}
            >
              やめる
            </Button>
          </div>
        </div>
      )}

      {skipAsk && autoRun && (
        <div className="flex flex-col gap-2 rounded-md border border-line px-4 py-3">
          <p className="text-[14px] leading-[1.7]">この日だけ送りません。投稿は下書きに残ります。次の投稿からは、いつもどおり自動で送ります。</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={skipping} onClick={skip}>
              {skipping ? "飛ばしています…" : "この日の投稿を飛ばす"}
            </Button>
            <Button type="button" variant="text" size="sm" disabled={skipping} onClick={() => setSkipAsk(false)}>
              やめる
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
        {review ? (
          <Link href={reviewHref} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[14px] font-bold text-on-primary hover:no-underline">
            中身を見て確認する
          </Link>
        ) : (
          <>
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => goStep(1)}>
              内容を編集する
            </Button>
            {!changing && (
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setChanging(true)}>
                予約の日時を変える
              </Button>
            )}
          </>
        )}
        {canSkip && !skipAsk && (
          <Button type="button" variant="secondary" size="sm" disabled={pending || skipping} onClick={() => setSkipAsk(true)}>
            この日の投稿を飛ばす
          </Button>
        )}
        {!autoRun && (
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => submit("draft")}>
            {busy === "draft" ? "下書きに戻しています…" : "予約をやめて下書きに戻す"}
          </Button>
        )}
        {deleteRow(false, "この投稿を削除する")}
      </div>
    </section>
  );
}
