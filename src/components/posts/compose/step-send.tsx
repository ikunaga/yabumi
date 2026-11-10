"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { HelpTip } from "@/components/ui/help";
import { SendProgress } from "../send-progress";
import { BAND_INFO, plannedAtFor } from "@/lib/metrics/time-bands";
import { COMPOSE_STEPS, blockerStep } from "@/lib/posts/compose-steps";
import { QUIET_BLOCKER, type Composer } from "./use-composer";

// ⑤ 送る: 日時・予約・今すぐ・下書き・削除（compose-steps.md）
export function ComposeStepSend({ c, steps = false }: { c: Composer; steps?: boolean }) {
  const { composeStep, goStep, stepProblems, timeHint, images, plannedAt, setPlannedAt, confirmSend, setConfirmSend, pending, busy, sending, missingConnectMessage, blocker, nowBlocker, clearFieldError, submit, fe, connectHref, mode, labels, sentLabels, deleteRow } = c;
  const fixAt = blockerStep(blocker, stepProblems);
  return (
    <>
      {/* 送る日時と送る */}
      <div className="flex flex-wrap items-center gap-2">
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
      {timeHint && (
        <div className="-mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          <span>{timeHint.kind === "views" ? "この時間帯がよく見られています（傾向）" : "この時間帯によくクリックされています（傾向）"}</span>
          <button
            type="button"
            onClick={() => {
              const [ymd, hm] = jstNow();
              setPlannedAt(plannedAtFor(timeHint.band, plannedAt, ymd, hm));
              clearFieldError("plannedAt");
            }}
            className={chipClass({ className: "h-7 px-2.5 text-[12px]" })}
          >
            {BAND_INFO[timeHint.band].label}（{BAND_INFO[timeHint.band].hours}）· {BAND_INFO[timeHint.band].at} にする
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
          <Button type="button" size="lg" disabled={pending || blocker !== null} onClick={() => submit("schedule")} className="w-full">
            {busy === "schedule" ? "予約しています…" : labels.schedule}
          </Button>
          <p className={`text-[13px] ${fe.plannedAt || (blocker && blocker !== QUIET_BLOCKER) ? "text-signal" : "text-faint"}`}>
            {fe.plannedAt ?? blocker ?? "予約すると、この日時に自動で送ります"}
            {!fe.plannedAt && blocker === missingConnectMessage && (
              <>
                {" "}
                <Link href={connectHref} className="font-semibold text-fg underline">
                  つなぐ →
                </Link>
              </>
            )}
            {/* どのステップで直すかを添える（ステップの画面のとき。いまのステップで直すものと、つなぐものは除く） */}
            {steps && !fe.plannedAt && fixAt !== null && fixAt !== composeStep && blocker !== missingConnectMessage && (
              <>
                {" "}
                <button type="button" onClick={() => goStep(fixAt)} className="font-semibold text-fg underline">
                  直す（{fixAt} {COMPOSE_STEPS[fixAt - 1].label}）→
                </button>
              </>
            )}
          </p>
          {/* 今すぐ送るは取り消しにくいので、押したら確かめる */}
          <div className="flex flex-wrap items-center gap-2">
            {confirmSend ? (
              <>
                <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => submit("now")}>
                  本当に{labels.now}
                </Button>
                <Button type="button" variant="text" size="sm" disabled={pending} onClick={() => setConfirmSend(false)}>
                  やめる
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending || nowBlocker !== null}
                title={nowBlocker ?? undefined}
                onClick={() => setConfirmSend(true)}
              >
                {busy === "now" ? "送っています…" : labels.now}
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => submit("draft")}>
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
