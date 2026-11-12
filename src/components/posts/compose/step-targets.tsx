"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { LearningTip } from "@/components/learning/learning-tip";
import { hasUrl } from "@/lib/learning/tips";
import { Input } from "@/components/ui/field";
import { SNS, SNS_KEYS, countHashtags, INSTAGRAM_MAX_HASHTAGS, type SnsKey } from "@/lib/sns";
import { HASHTAG_RULES, MAX_TARGET_HASHTAGS } from "@/lib/sns/hashtags";
import { type Composer } from "./use-composer";

// ② 送り先: SNS を選ぶ・送り先の注意・引用（compose-steps.md）
export function ComposeStepTargets({ c }: { c: Composer }) {
  const { connected, selected, overrides, quote, setQuote, textFor, checks, isLocked, chosen, learnFrom, quoting, clearFieldError, toggle, fe, connectHref, targetState, sentState, countText, warnings, mode } = c;
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
                {sentState(sns) && <span className={sentState(sns)!.tone}>{sentState(sns)!.text}</span>}
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

      {chosen.length > 0 && <TargetHashtags c={c} />}

      {mode !== "all_sent" && (
        <>
          <LearningTip trigger="instagram_selected" when={!learnFrom.instagram && chosen.includes("instagram")} />
          <LearningTip trigger="url_in_body" when={!learnFrom.url && chosen.some((s) => hasUrl(textFor(s)))} />
        </>
      )}
    </>
  );
}

// SNS ごとのタグ（docs/architecture.md の 4.59）。本文とは別に持ち、送るときに本文の下に 1 行あけて付く。
// 投稿のフォーマットを本文に入れると、そのタグが入る。送った SNS は直せない（送り直さない）
function TargetHashtags({ c }: { c: Composer }) {
  const { chosen, tagInputs, setTagInputs, tagsFor, tagProblem, textFor, isLocked, sentState, markTyped, clearFieldError } = c;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-[14px] font-bold">
        タグ<span className="ml-1.5 text-[13px] font-normal text-muted">本文の下に付きます・SNS ごとに {MAX_TARGET_HASHTAGS} 個まで</span>
      </legend>
      <ul className="flex flex-col gap-2">
        {chosen.map((sns) => {
          const locked = isLocked(sns);
          const problem = locked ? null : tagProblem(sns);
          const note = locked ? null : tagNote(sns, tagsFor(sns).length, countHashtags(textFor(sns)));
          return (
            <li key={sns} className="flex flex-col gap-1">
              <label className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
                <span className="w-24 shrink-0 text-[13px] font-bold max-sm:w-auto">{SNS[sns].label}</span>
                <Input
                  value={tagInputs[sns] ?? ""}
                  maxLength={400}
                  disabled={locked}
                  onChange={(e) => {
                    markTyped();
                    clearFieldError("targets");
                    setTagInputs((o) => ({ ...o, [sns]: e.target.value }));
                  }}
                  placeholder={locked ? "" : "例: #個人開発 #indiedev"}
                  className="min-w-0 flex-1 py-2 text-sm"
                />
              </label>
              {locked && <span className="pl-[108px] text-xs text-muted max-sm:pl-0">{sentState(sns)?.plain ?? "投稿済み"}（直しても送り直しません）</span>}
              {problem ? (
                <span className="pl-[108px] text-xs font-semibold text-danger max-sm:pl-0">{problem}</span>
              ) : (
                note && <span className={`pl-[108px] text-xs max-sm:pl-0 ${note.danger ? "font-semibold text-danger" : "text-muted"}`}>{note.text}</span>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

// タグの数の目安（Instagram は本文のタグと合わせて 5 個まで。Threads は 1 つ目だけがタグになる。ほかは目安を超えたら添える）
function tagNote(sns: SnsKey, tags: number, total: number): { text: string; danger?: boolean } | null {
  if (tags === 0) return null;
  if (sns === "instagram") {
    if (total > INSTAGRAM_MAX_HASHTAGS) return { text: `本文のタグと合わせて ${INSTAGRAM_MAX_HASHTAGS} 個までです（いま ${total} 個）`, danger: true };
    return null;
  }
  if (sns === "threads") return total > 1 ? { text: "Threads は 1 つ目だけがタグになります" } : null;
  const rule = HASHTAG_RULES[sns];
  return total > rule.max ? { text: `目安: ${rule.text}` } : null;
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
