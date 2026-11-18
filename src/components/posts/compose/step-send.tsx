"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { HelpTip } from "@/components/ui/help";
import { SendProgress } from "../send-progress";
import { BAND_INFO, plannedAtFor } from "@/lib/metrics/time-bands";
import { COMPOSE_STEPS, blockerStep } from "@/lib/posts/compose-steps";
import { SNS } from "@/lib/sns";
import { QUIET_BLOCKER, type Composer } from "./use-composer";
import { XBudgetNotice } from "./x-budget-notice";
import { ComposeTikTok } from "./tiktok-panel";
import { ComposeYouTube } from "./youtube-panel";

// ⑤ 送る: 日時・予約・今すぐ・下書き・削除（compose-steps.md）
// previewBelow: SNS ごとの見え方が、このあと（送るボタンより下）に出る（狭い幅）。送るボタンの上に、見え方への短い案内を出す（2026-11-18 PMO の付箋 24）
export function ComposeStepSend({ c, steps = false, previewBelow = false }: { c: Composer; steps?: boolean; previewBelow?: boolean }) {
  const { composeStep, goStep, stepProblems, timeHint, images, plannedAt, setPlannedAt, confirmSend, setConfirmSend, pending, busy, sending, missingConnectMessage, blocker, nowBlocker, clearFieldError, submit, fe, connectHref, mode, labels, sentLabels, deleteRow, toSend, byHandOrManual, recheckX, xChecking, scheduleAsked, askSchedule } = c;
  // いつ送るか: 「今すぐ送る」と「予約する」を先に選ぶ（前は日時の欄が空のまま「今すぐ送る」が並び、どちらになるか迷った。2026-11-18 PMO の付箋 23）。
  // 選ぶまでは、日時が入っていれば予約、空なら今すぐ（下書きを開いたとき・書きかけを戻したときも、日時に合わせる）
  const [whenPick, setWhenPick] = useState<"now" | "schedule" | null>(null);
  const nowMain = (whenPick ?? (plannedAt ? "schedule" : "now")) === "now";
  const pickWhen = (w: "now" | "schedule") => {
    setWhenPick(w);
    setConfirmSend(false);
  };
  const mainBlocker = nowMain ? nowBlocker : blocker;
  const fixAt = blockerStep(mainBlocker, stepProblems);
  // 今すぐ送る SNS の名前（確かめに出す。note・Substack は手で投稿するので入れない）
  // 今すぐ送る SNS の名前（手で投稿する SNS と、「X は手で投稿する」を選んだ X は送らないので入れない）
  const nowNames = toSend.filter((s) => !byHandOrManual(s)).map((s) => SNS[s].label).join("・");
  return (
    <>
      {mode !== "all_sent" && (
        <div role="radiogroup" aria-label="いつ送るか" className="grid grid-cols-2 gap-2">
          {(
            [
              ["now", labels.now],
              ["schedule", "予約する"],
            ] as const
          ).map(([w, text]) => {
            const on = (w === "now") === nowMain;
            return (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pickWhen(w)}
                className={`flex h-11 items-center justify-center gap-2 rounded-md border px-3 text-[14px] ${on ? "border-primary bg-surface font-bold text-fg" : "border-border bg-surface text-muted hover:border-input hover:text-fg"}`}
              >
                <span aria-hidden className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${on ? "border-primary" : "border-input"}`}>
                  {on && <span className="size-2 rounded-full bg-primary" />}
                </span>
                {text}
              </button>
            );
          })}
        </div>
      )}
      {/* 送る日時（予約のときだけ。送った投稿では、送った日時を見せるために出したまま） */}
      <div hidden={mode !== "all_sent" && nowMain} className="flex flex-wrap items-center gap-2">
        <label htmlFor="planned-at" className="sr-only">
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
          className={`num h-9 rounded-md border bg-surface px-3 text-[14px] text-fg outline-none max-sm:text-[16px] ${fe.plannedAt ? "border-danger shadow-[0_0_0_1px_var(--danger)]" : "border-border focus:border-primary"}`}
        />
        <span className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[14px] text-muted">日本時間</span>
      </div>
      {timeHint && mode !== "all_sent" && (
        <div className="-mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          <span>{timeHint.kind === "views" ? "この時間帯がよく見られています（傾向）" : "この時間帯によくクリックされています（傾向）"}</span>
          <button
            type="button"
            onClick={() => {
              const [ymd, hm] = jstNow();
              setPlannedAt(plannedAtFor(timeHint.band, plannedAt, ymd, hm));
              clearFieldError("plannedAt");
              pickWhen("schedule");
            }}
            className={chipClass({ className: "h-7 px-2.5 text-[12px]" })}
          >
            {BAND_INFO[timeHint.band].label}（{BAND_INFO[timeHint.band].hours}）· {BAND_INFO[timeHint.band].at} {nowMain ? "に予約する" : "にする"}
          </button>
          <HelpTip label="時間帯の傾向">
           yabumi が数えた、直近 90 日のあなたの数字です（{timeHint.kind === "views" ? "送った時間帯ごとの 1 本あたりの閲覧数" : "短縮リンクが押された時間帯"}）。傾向であって、この時間に送れば必ず見られるわけではありません。
          </HelpTip>
        </div>
      )}

      {mode === "all_sent" ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3.5">
          <p className="text-[14px] leading-[1.7] text-muted">
            {steps ? "まだ送る SNS を選んでいません。「2 送り先」で、ほかの SNS を選んでください。" : "送った投稿です。直すときは各 SNS で、取り消すときは上の「送信の結果」から。ほかの SNS にも送るときは、送り先のチップで選んでください。"}
          </p>
          {deleteRow(true)}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {mode === "partial" && (
            <p className="text-[13px] text-muted">
              {sentLabels} には送信済みです（送り直しません）。残りの SNS の分だけ予約・送信できます。
            </p>
          )}
          {sending && <SendProgress postId={sending.postId} sns={sending.sns} hasImages={images.length > 0} />}
          <XBudgetNotice c={c} />
          {toSend.includes("tiktok") && <ComposeTikTok c={c} />}
          {toSend.includes("youtube") && <ComposeYouTube c={c} />}
          {previewBelow && (
            <button
              type="button"
              onClick={() => document.getElementById("compose-preview")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="self-start text-[13px] font-semibold text-fg underline underline-offset-2"
            >
              送る前に、SNS ごとの見え方を確かめる ↓
            </button>
          )}
          {nowMain && confirmSend ? (
            // 今すぐ送るは取り消しにくいので、送り先の SNS の名前を出して確かめる
            <div className="flex flex-col gap-2 rounded-md border border-line px-3.5 py-3">
              <p className="text-[14px] leading-[1.7]">
                <b>{nowNames}</b> に、いますぐ送ります。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {/* 押したときの X の上限の調べ直しが済むまで押せない（上限に当たったら、この確かめは閉じて知らせだけになる） */}
                <Button type="button" disabled={pending || xChecking} onClick={() => submit("now")}>
                  {xChecking ? "上限を確かめています…" : `本当に${labels.now}`}
                </Button>
                <Button type="button" variant="text" disabled={pending} onClick={() => setConfirmSend(false)}>
                  やめる
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              size="lg"
              disabled={pending || scheduleAsked || mainBlocker !== null}
              onClick={() => (nowMain ? (recheckX(), setConfirmSend(true)) : askSchedule())}
              className="w-full"
            >
              {nowMain ? (busy === "now" ? "送っています…" : labels.now) : scheduleAsked ? "上限を確かめています…" : busy === "schedule" ? "予約しています…" : labels.schedule}
            </Button>
          )}
          <p className={`text-[13px] ${fe.plannedAt || (mainBlocker && mainBlocker !== QUIET_BLOCKER) ? "text-signal" : "text-faint"}`}>
            {fe.plannedAt ?? mainBlocker ?? (nowMain ? `${nowNames} に、押してすぐ送ります` : nowNames ? "予約すると、この日時に自動で送ります" : "この日時に、手で投稿する番として知らせます")}
            {!fe.plannedAt && mainBlocker === missingConnectMessage && (
              <>
                {" "}
                <Link href={connectHref} className="font-semibold text-fg underline">
                  つなぐ →
                </Link>
              </>
            )}
            {/* どのステップで直すかを添える（ステップの画面のとき。いまのステップで直すものと、つなぐものは除く） */}
            {steps && !fe.plannedAt && fixAt !== null && fixAt !== composeStep && mainBlocker !== missingConnectMessage && (
              <>
                {" "}
                <button type="button" onClick={() => goStep(fixAt)} className="font-semibold text-fg underline">
                  直す（{fixAt} {COMPOSE_STEPS[fixAt - 1].label}）→
                </button>
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={pending || c.videoBusy} onClick={() => submit("draft")}>
              {busy === "draft" ? "保存しています…" : "下書きに保存する"}
            </Button>
            {deleteRow(mode === "partial")}
          </div>
        </div>
      )}
    </>
  );
}

// 日本時間のいまの日付と時刻（"YYYY-MM-DD" と "HH:MM"）
function jstNow(): [string, string] {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return [`${p.year}-${p.month}-${p.day}`, `${p.hour}:${p.minute}`];
}
