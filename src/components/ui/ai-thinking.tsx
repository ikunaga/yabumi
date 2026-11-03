"use client";

// AI を待っている間の表示（docs/architecture.md の 4.51）。止まって見えないように動きを付け、経った秒数と段階の文を出す。
// chat: 会話の AI の吹き出しの位置に、3 つの点が順に弾む「入力中」の印。progress: 待つ時間が長いもの（整える・ネタ・画像）に、左右に流れる細いバー。
// 段階の文は経った秒数で切り替える目安（src/lib/ai/thinking.ts。本当の進み具合ではないので % は出さない）。
// 読み上げは段階の文が変わったときだけ（秒数は aria-hidden）。動きを減らす設定では動きを止め、秒数だけ進める
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { elapsedLabel, elapsedSeconds, THINKING_STAGES, thinkingStage, type ThinkingKind } from "@/lib/ai/thinking";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCE_QUERY).matches, () => false);
}

type Props = {
  kind: ThinkingKind;
  variant?: "chat" | "progress";
  // 待ち始めた時刻（Date.now()）。なければ出た時から数える
  startedAt?: number | null;
  // 動きの下に小さく出す目安（「10〜30 秒ほどかかることがあります」など）
  note?: ReactNode;
  // 目安の横に並べるもの（「やめる」など）
  children?: ReactNode;
  className?: string;
};

export function AiThinking({ kind, variant = "progress", startedAt, note, children, className = "" }: Props) {
  const reduced = useReducedMotion();
  const [start] = useState(() => startedAt ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <AiThinkingView kind={kind} variant={variant} seconds={elapsedSeconds(startedAt ?? start, now)} reduced={reduced} note={note} className={className}>{children}</AiThinkingView>;
}

// 表示だけ（テストで秒数と動きを減らす設定を決めて描く）
export function AiThinkingView({ kind, variant = "progress", seconds, reduced, note, children, className = "" }: Omit<Props, "startedAt"> & { seconds: number; reduced: boolean }) {
  const stage = thinkingStage(THINKING_STAGES[kind], seconds);
  const time = (
    <span aria-hidden className="num font-normal text-muted">
      {elapsedLabel(seconds)}
    </span>
  );
  const foot = (note || children) && (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-[1.7] text-muted">
      {note && <span>{note}</span>}
      {children}
    </p>
  );

  if (variant === "chat") {
    return (
      <div role="status" aria-live="polite" data-motion={reduced ? "reduce" : "on"} className={`flex flex-col gap-1.5 ${className}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span aria-hidden className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-3.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`size-2 rounded-full bg-primary ${reduced ? "opacity-60" : "motion-safe:animate-[ai-dot_1.2s_ease-in-out_infinite]"}`}
                style={reduced ? undefined : { animationDelay: `${i * 0.18}s` }}
              />
            ))}
          </span>
          <span className="flex items-baseline gap-2 text-sm font-semibold text-fg">
            <span>{stage}</span>
            {time}
          </span>
        </div>
        {foot}
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" data-motion={reduced ? "reduce" : "on"} className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-fg">
        <span>{stage}</span>
        {time}
      </p>
      <span aria-hidden className="relative block h-1 w-full max-w-60 overflow-hidden rounded-full bg-primary/15">
        <span className={`absolute inset-y-0 left-0 w-1/3 rounded-full bg-primary ${reduced ? "opacity-40" : "motion-safe:animate-[ai-bar_1.6s_ease-in-out_infinite]"}`} />
      </span>
      {foot}
    </div>
  );
}
