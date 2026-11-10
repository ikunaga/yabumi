"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { LearningTip } from "@/components/learning/learning-tip";
import { hasUrl } from "@/lib/learning/tips";
import { SNS, SNS_KEYS } from "@/lib/sns";
import { type Composer } from "./use-composer";

// ② 送り先: SNS を選ぶ・送り先の注意・引用（compose-steps.md）
export function ComposeStepTargets({ c }: { c: Composer }) {
  const { connected, selected, overrides, quote, setQuote, textFor, checks, isLocked, chosen, learnFrom, quoting, clearFieldError, toggle, fe, connectHref, targetState, countText, warnings, mode } = c;
  return (
    <>
      {/* 送り先。PC は字数つきのチップ（見本 B）、スマホは行（見本 D） */}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">送り先の SNS</legend>
        <div className="flex flex-wrap gap-2 max-sm:hidden">
          {SNS_KEYS.map((sns) => {
            const on = selected.has(sns);
            const over = on && checks[sns].issues.includes("too_long");
            return (
              <button
                key={sns}
                type="button"
                aria-pressed={on}
                disabled={isLocked(sns)}
                onClick={() => toggle(sns)}
                className={chipClass({ on, className: "disabled:cursor-not-allowed" })}
              >
                {on && <span aria-hidden>✓</span>}
                {SNS[sns].label}
                {on && <span className={`num ${over ? "text-danger" : ""}`}>{countText(sns)}</span>}
                {overrides[sns] !== undefined && <span aria-hidden>✎</span>}
                {isLocked(sns) && <span className="text-success">投稿済み</span>}
              </button>
            );
          })}
        </div>
        <ul className="flex flex-col gap-1.5 sm:hidden">
          {SNS_KEYS.map((sns) => {
            const on = selected.has(sns);
            const state = targetState(sns);
            // 1 段目の右には字数と短い状態（OK・オフ）だけ。長い印（画像が必要・つないでいない・投稿済みなど）と「文面を変更」は、
            // 名前の下の 2 段目にまとめる（320 幅でも 1 段目が折れないように）
            const inline = state && (!on || state.text === "OK") ? state : null;
            const below = state && !inline ? state : null;
            const changed = overrides[sns] !== undefined;
            return (
              <li key={sns}>
                <label className={`flex min-h-11 flex-col justify-center gap-0.5 rounded-md border px-3.5 py-2 text-[15px] ${on ? "border-border bg-surface" : "border-line bg-surface2"}`}>
                  <span className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={isLocked(sns)}
                      onChange={() => toggle(sns)}
                      className="size-[18px] shrink-0 accent-[var(--primary)]"
                    />
                    <span className={`min-w-0 truncate ${on ? "font-bold" : "text-muted"}`}>{SNS[sns].label}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2 text-[13px]">
                      {on && !isLocked(sns) && <span className="num text-faint">{countText(sns)}</span>}
                      {inline && <span className={inline.tone}>{inline.text}</span>}
                    </span>
                  </span>
                  {(below || changed) && (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[30px] text-xs">
                      {below && <span className={below.tone}>{below.text}</span>}
                      {changed && <span className="text-muted">✎ 文面を変更</span>}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
        {warnings.length > 0 && (
          <ul className="flex flex-col gap-1 text-[13px] max-sm:hidden">
            {warnings.map((w) => (
              <li key={w.sns}>
                <span className={w.state!.tone}>● {SNS[w.sns].label}: {w.state!.text}</span>
              </li>
            ))}
          </ul>
        )}
        {quoting && (
          <QuoteTag
            id={quote!}
            onRemove={() => {
              setQuote(null);
              clearFieldError("targets");
            }}
          />
        )}
        {fe.targets && (
          <p role="alert" className="text-sm font-semibold text-danger">
            {fe.targets}
          </p>
        )}
        {connected.length === 0 && mode !== "all_sent" && (
          <p className="text-[13px] text-muted">
            まだ SNS をつないでいません（下書きは保存できます）。{" "}
            <Link href={connectHref} className="font-semibold text-fg underline">
              先に SNS をつなぐ →
            </Link>
          </p>
        )}
      </fieldset>

      {mode !== "all_sent" && (
        <>
          <LearningTip trigger="instagram_selected" when={!learnFrom.instagram && chosen.includes("instagram")} />
          <LearningTip trigger="url_in_body" when={!learnFrom.url && chosen.some((s) => hasUrl(textFor(s)))} />
        </>
      )}
    </>
  );
}

// 引用する X の投稿の札（4.52）。外すと、ふつうの X の投稿になる
function QuoteTag({ id, onRemove }: { id: string; onRemove: () => void }) {
  const url = `https://x.com/i/web/status/${id}`;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-line bg-surface2 px-3.5 py-2 text-[13px]">
      <span className="font-bold">引用:</span>
      <a href={url} target="_blank" rel="noopener noreferrer" className="num min-w-0 break-all text-primary hover:underline">
        x.com/i/web/status/{id}
      </a>
      <Button type="button" variant="text" size="sm" onClick={onRemove} className="ml-auto">
        引用を外す
      </Button>
    </div>
  );
}
