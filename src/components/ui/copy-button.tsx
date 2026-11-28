"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "./button";

// 値をコピーするボタン。値の文字と見分けがつくように、枠とアイコンのある小さなボタンにする（2026-11-28 オーナーの指摘「コピーが値の続きの文字に見える」）。
// - ボタンの文字は選択に入らない（select-none）。値を選んで写すときに「コピー」まで写らないように
// - 押したら 2 秒「コピーしました」を出し、読み上げにも aria-live で伝える
// - スマホでは指で押せる高さ 44px にする
export function CopyButton({ text, label = "コピー", onError }: { text: string; label?: string; onError?: () => void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
      onError?.();
    }
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    // できなかったときは、次にすることを読めるように長めに出す
    timer.current = setTimeout(() => setState("idle"), ok ? 2000 : 5000);
  }

  const shown = state === "copied" ? "コピーしました" : state === "failed" && !onError ? "文字を選んでコピー" : label;
  return (
    <span className="inline-flex shrink-0 select-none">
      <button type="button" onClick={copy} className={buttonClass({ variant: "secondary", size: "sm", className: "gap-1.5 px-2.5 max-sm:h-11 max-sm:px-3.5" })}>
        {state === "copied" ? <CheckIcon /> : <CopyIcon />}
        <span>{shown}</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? "コピーしました" : state === "failed" && !onError ? "コピーできませんでした" : ""}
      </span>
    </span>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="size-3.5 shrink-0">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0 text-success">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}
