"use client";

import { useState, useTransition } from "react";
import { Button, NotReadyButton } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { checkPostTexts } from "@/lib/ai/ai-check-actions";
import { FINDING_LABEL, type AiCheckFinding, type AiCheckResult, type CheckText } from "@/lib/ai/ai-check";
import { SNS, type SnsKey } from "@/lib/sns";

type Props = {
  projectId: string;
  aiEnabled: boolean;
  // いま送る予定の文面（SNS ごと）
  texts: CheckText[];
  // 直しを当てる。当てられたら true（文面が変わって見つからなければ false）
  onApply: (sns: SnsKey, quote: string, fix: string) => boolean;
};

// AI っぽさチェック（要求 F11）: 送る前に、決まり文句・誇張・作り話になっていないかを AI が見て知らせる。送るのは止めない
export function AiCheckPanel({ projectId, aiEnabled, texts, onApply }: Props) {
  const [result, setResult] = useState<AiCheckResult | null>(null);
  const [state, setState] = useState<Record<number, "applied" | "dismissed" | "missing">>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hasText = texts.some((t) => t.text.trim());

  const run = () =>
    startTransition(async () => {
      setError(null);
      const res = await checkPostTexts(projectId, texts.filter((t) => t.text.trim()));
      if (res.error || !res.result) {
        setError(res.error ?? "うまくいきませんでした。");
        return;
      }
      setResult(res.result);
      setState({});
    });

  const visible = result?.findings.map((f, i) => ({ f, i })).filter(({ i }) => state[i] !== "dismissed") ?? [];

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm" aria-labelledby="ai-check-heading">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="ai-check-heading" className="font-bold">
          送る前に AI に見てもらう
        </h2>
        {aiEnabled ? (
          <Button type="button" variant="secondary" size="sm" disabled={pending || !hasText} onClick={run}>
            {pending ? "確かめています…" : result ? "もう一度確かめる" : "AI っぽくないか確かめる"}
          </Button>
        ) : (
          <NotReadyButton variant="secondary" size="sm">
            AI っぽくないか確かめる
          </NotReadyButton>
        )}
      </div>
      <p className="text-xs leading-[1.7] text-muted">
        決まり文句、大げさな言葉、書いた人しか知らない事実（本当かどうか）、ハッシュタグの付けすぎ、設計の口調とのずれを見ます。直すかどうかはあなたが選べます。送るのは止めません（1 回 5 円ほど）。
      </p>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {result && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <p className="flex items-start gap-2 leading-[1.7]">
            <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">AI の見立て</span>
            <span>{result.summary || (result.findings.length ? "" : "気になるところは見つかりませんでした。")}</span>
          </p>
          {result.findings.length > 0 && visible.length === 0 && <p className="text-muted">指摘はすべて確かめました。</p>}
          <ul className="flex flex-col gap-3">
            {visible.map(({ f, i }) => (
              <FindingItem
                key={i}
                f={f}
                state={state[i]}
                onApply={() => {
                  // 親の文面を書き換えてから、この指摘の状態を変える（状態の更新の中で親を書き換えない）
                  const applied = onApply(f.sns, f.quote, f.fix);
                  setState((s) => ({ ...s, [i]: applied ? "applied" : "missing" }));
                }}
                onDismiss={() => setState((s) => ({ ...s, [i]: "dismissed" }))}
                showSns={new Set(texts.map((t) => t.sns)).size > 1}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function FindingItem({
  f,
  state,
  onApply,
  onDismiss,
  showSns,
}: {
  f: AiCheckFinding;
  state?: "applied" | "dismissed" | "missing";
  onApply: () => void;
  onDismiss: () => void;
  showSns: boolean;
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-line bg-surface2 px-3.5 py-3 leading-[1.7]">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {f.kind === "made_up" ? (
          <span className="font-bold text-signal">● {FINDING_LABEL[f.kind]}</span>
        ) : (
          <span className="rounded-full border border-border px-2 py-0.5 font-semibold text-muted">{FINDING_LABEL[f.kind]}</span>
        )}
        {showSns && <span className="text-muted">{SNS[f.sns].label} の文面</span>}
      </div>
      <p>「{f.quote}」</p>
      <p className="text-muted">{f.why}</p>
      <p>
        <span className="text-muted">直した案: </span>
        {f.fix ? `「${f.fix}」` : "このところを消す"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {state === "applied" ? (
          <span className="text-xs font-bold text-success">✓ 直しました</span>
        ) : state === "missing" ? (
          <span className="text-xs text-muted">文面が変わっていて、当てられませんでした。手で直してください。</span>
        ) : (
          <>
            <Button type="button" variant="secondary" size="sm" onClick={onApply}>
              この直しを使う
            </Button>
            <Button type="button" variant="text" size="sm" onClick={onDismiss}>
              そのままにする
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
