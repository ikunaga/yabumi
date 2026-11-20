"use client";

import { COMPOSE_STEPS, LAST_STEP, type StepNo } from "@/lib/posts/compose-steps";
import { type Composer } from "./use-composer";

// 上のステップの進み（docs/design/compose-steps.md の 3.）。PC は 5 つの札、スマホは点と段の名前。済んだ段はどちらも ✓
// いまどこか・済んだか（✓）を見せるだけで、押しても移らない。移るのは下の帯の「次へ」「戻る」だけ（2026-11-14 オーナーの依頼）
export function ComposeStepNav({ c }: { c: Composer }) {
  const { composeStep, marks } = c;
  const markText = (n: StepNo) => (marks[n] === "problem" ? "・確認が要るところがあります" : marks[n] === "done" ? "・完了" : "");
  return (
    <nav aria-label="投稿をつくるステップ" className="flex flex-col gap-2">
      <ol className="flex flex-wrap items-center gap-1.5 max-sm:hidden">
        {COMPOSE_STEPS.map((s, i) => {
          const n = (i + 1) as StepNo;
          const on = n === composeStep;
          return (
            <li key={s.key} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden className="h-px w-5 bg-line" />}
              <span
                aria-current={on ? "step" : undefined}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] ${on ? "border-primary bg-primary text-on-primary font-bold" : "border-border bg-surface text-fg"}`}
              >
                <span className="num">{n}</span>
                {s.label}
                {marks[n] === "done" && !on && <span aria-hidden className="text-success">✓</span>}
                {marks[n] === "problem" && <span aria-hidden className={on ? "" : "text-signal"}>●</span>}
                <span className="sr-only">{markText(n)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {/* スマホ: 点の下に段の名前を出す（前は「2/5 送り先」と点だけで、5 段あることと、ほかの段の名前が読めなかった。2026-11-18 PMO の付箋 6） */}
      <ol className="grid grid-cols-5 sm:hidden">
        {COMPOSE_STEPS.map((s, i) => {
          const n = (i + 1) as StepNo;
          const on = n === composeStep;
          return (
            <li key={s.key} aria-current={on ? "step" : undefined} className="flex flex-col items-center gap-1">
              <span className="sr-only">{`${n}/${LAST_STEP} ${s.label}${markText(n)}`}</span>
              {/* 済んだ段は PC の札と同じ ✓ にそろえる（前は灰色の点で、PC の ✓ と表し方が違った。2026-11-21 PM） */}
              <span aria-hidden className="flex size-4 items-center justify-center">
                {marks[n] === "done" && !on ? (
                  <span className="text-[13px] leading-none font-bold text-success">✓</span>
                ) : (
                  <span
                    className={`block rounded-full ${on ? "size-3 bg-primary ring-2 ring-primary ring-offset-2 ring-offset-bg" : `size-2.5 ${marks[n] === "problem" ? "bg-signal" : "border border-input bg-surface"}`}`}
                  />
                )}
              </span>
              <span aria-hidden className={`text-center text-[11px] leading-tight whitespace-nowrap ${on ? "font-bold text-fg" : "text-muted"}`}>
                <span className="num">{n}</span> {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
