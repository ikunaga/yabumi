"use client";

import { COMPOSE_STEPS, LAST_STEP, type StepNo } from "@/lib/posts/compose-steps";
import { type Composer } from "./use-composer";

// 上のステップの進み（docs/design/compose-steps.md の 3.）。PC は 5 つの札、スマホは「2/5 送り先」と点。
// いまどこか・済んだか（✓）を見せるだけで、押しても移らない。移るのは下の帯の「次へ」「戻る」だけ（2026-11-14 オーナーの依頼）
export function ComposeStepNav({ c }: { c: Composer }) {
  const { composeStep, marks } = c;
  const current = COMPOSE_STEPS[composeStep - 1];
  const markText = (n: StepNo) => (marks[n] === "problem" ? "（直すところがあります）" : marks[n] === "done" ? "（済み）" : "");
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
      <div className="flex items-center justify-between gap-3 sm:hidden">
        <p className="text-[15px] font-bold">
          <span className="num">
            {composeStep}/{LAST_STEP}
          </span>{" "}
          {current.label}
        </p>
        <ol className="flex items-center gap-1">
          {COMPOSE_STEPS.map((s, i) => {
            const n = (i + 1) as StepNo;
            const on = n === composeStep;
            return (
              <li key={s.key}>
                <span aria-current={on ? "step" : undefined} className="flex size-8 items-center justify-center">
                  <span className="sr-only">{`${n} ${s.label}${markText(n)}`}</span>
                  <span
                    aria-hidden
                    className={`block rounded-full ${on ? "size-3 bg-primary ring-2 ring-primary ring-offset-2 ring-offset-bg" : `size-2.5 ${marks[n] === "problem" ? "bg-signal" : marks[n] === "done" ? "bg-faint" : "border border-input bg-surface"}`}`}
                  />
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
