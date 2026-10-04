"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { sendCoachMessage } from "@/lib/ai/plan-coach-actions";
import type { AssistantContent, StoredMessage } from "@/lib/ai/plan-coach";
import { sectionLabel } from "@/lib/ai/plan-coach-prompt";
import { describeSection } from "@/lib/plan/describe";
import type { SectionKey } from "@/lib/plan/schema";

type Input =
  | { kind: "start"; focus: SectionKey | null }
  | { kind: "text"; text: string }
  | { kind: "focus"; focus: SectionKey }
  | { kind: "adopt"; messageId: string; optionIndex: number };

// アカウント設計を AI と話しながら進める画面
export function PlanCoachChat({
  projectId,
  threadId: initialThreadId,
  messages,
  initialFocus,
}: {
  projectId: string;
  threadId: string | null;
  messages: StoredMessage[];
  // 設計の画面の「AI と考える」から来たときのセクション
  initialFocus: SectionKey | null;
}) {
  const router = useRouter();
  const [threadId, setThreadId] = useState(initialThreadId);
  const [text, setText] = useState("");
  const [sentText, setSentText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const startedFocus = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  function send(input: Input, opts: { newThread?: boolean } = {}) {
    setError(null);
    setSentText(input.kind === "text" ? input.text : null);
    startTransition(async () => {
      const res = await sendCoachMessage(projectId, opts.newThread ? null : threadId, input);
      if (res.threadId) setThreadId(res.threadId);
      if (res.ok) {
        if (input.kind === "text") setText("");
      } else {
        setError(res.message ?? "うまくいきませんでした。");
      }
      setSentText(null);
      router.refresh();
    });
  }

  // 設計の画面の「AI と考える」から来たら、そのセクションの相談を始める（1 回だけ）
  useEffect(() => {
    if (!initialFocus || startedFocus.current) return;
    startedFocus.current = true;
    router.replace(`/projects/${projectId}/plan/chat`, { scroll: false });
    send(threadId ? { kind: "focus", focus: initialFocus } : { kind: "start", focus: initialFocus });
    // 最初の 1 回だけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const visible = messages.filter((m) => !(m.role === "user" && m.content.kind === "start"));

  function submitText() {
    const t = text.trim();
    if (!t || pending) return;
    send({ kind: "text", text: t });
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 && !pending && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4">
          <p className="text-[14px] leading-[1.8]">
            AI が 1 つずつ質問します。答えにあわせて案を 2〜3 個、長所・短所とおすすめの理由つきで出すので、選ぶか、直したいところを伝えてください。選んだ案だけが設計に保存されます。
          </p>
          <Button onClick={() => send({ kind: "start", focus: null })}>相談をはじめる</Button>
        </div>
      )}

      <ol className="flex flex-col gap-4" aria-live="polite">
        {visible.map((m) =>
          m.role === "assistant" ? (
            <AssistantBubble
              key={m.id}
              message={m}
              isLatest={m.id === lastAssistant?.id}
              disabled={pending}
              onChoice={(c) => send({ kind: "text", text: c })}
              onAdopt={(i) => send({ kind: "adopt", messageId: m.id, optionIndex: i })}
              onRevise={(title) => {
                setText(`案「${title}」の、ここを直したい: `);
                inputRef.current?.focus();
              }}
            />
          ) : (
            <UserBubble key={m.id} message={m} />
          ),
        )}
        {pending && sentText && (
          <li className="flex justify-end">
            <p className="max-w-[80%] rounded-lg bg-primary-soft px-4 py-2.5 text-[14px] leading-[1.7] whitespace-pre-wrap">{sentText}</p>
          </li>
        )}
        {pending && (
          <li role="status" className="text-sm text-muted">
            AI が考えています…（10〜30 秒ほどかかることがあります）
          </li>
        )}
      </ol>
      <div ref={bottomRef} />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {(messages.length > 0 || pending) && (
        <div className="sticky bottom-0 z-[5] -mx-12 flex flex-col gap-2 border-t border-border bg-surface px-12 py-3 max-lg:-mx-8 max-lg:px-8 max-sm:bottom-[72px] max-sm:-mx-4 max-sm:px-4">
          <label htmlFor="coach-input" className="sr-only">
            AI への返事
          </label>
          <textarea
            id="coach-input"
            ref={inputRef}
            rows={2}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 日本語の変換を確定する Enter と区別するため、送るのは ⌘/Ctrl + Enter
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitText();
              }
            }}
            placeholder="自由に答えても大丈夫です（⌘ / Ctrl + Enter で送る）"
            className="w-full resize-none rounded-md border border-input bg-surface px-3.5 py-2.5 text-[14px] outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => send({ kind: "start", focus: null }, { newThread: true })}
              className="text-xs text-muted hover:text-fg hover:underline disabled:opacity-40"
            >
              最初から相談する（決まった設計は残ります）
            </button>
            <Button className="ml-auto" size="sm" disabled={pending || !text.trim()} onClick={submitText}>
              送る
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserBubble({ message }: { message: Extract<StoredMessage, { role: "user" }> }) {
  const c = message.content;
  if (c.kind === "adopt") {
    return (
      <li className="text-center text-sm text-success">
        ✓ 「{sectionLabel(c.section)}」に案「{c.title}」を採用しました
      </li>
    );
  }
  if (c.kind === "focus") {
    return <li className="text-center text-sm text-muted">「{sectionLabel(c.focus)}」を考えたい</li>;
  }
  if (c.kind !== "text") return null;
  return (
    <li className="flex justify-end">
      <p className="max-w-[80%] rounded-lg bg-primary-soft px-4 py-2.5 text-[14px] leading-[1.7] whitespace-pre-wrap">{c.text}</p>
    </li>
  );
}

function AssistantBubble({
  message,
  isLatest,
  disabled,
  onChoice,
  onAdopt,
  onRevise,
}: {
  message: Extract<StoredMessage, { role: "assistant" }>;
  isLatest: boolean;
  disabled: boolean;
  onChoice: (choice: string) => void;
  onAdopt: (index: number) => void;
  onRevise: (title: string) => void;
}) {
  const c: AssistantContent = message.content;
  return (
    <li className="flex flex-col gap-3">
      <div className="max-w-[88%] rounded-lg border border-border bg-surface px-4 py-3 max-sm:max-w-full">
        <p className="mb-1 text-xs font-bold text-primary">AI</p>
        <p className="text-[14px] leading-[1.8] whitespace-pre-wrap">{c.message}</p>
      </div>
      {c.proposal && <ProposalCard content={c} disabled={disabled} onAdopt={onAdopt} onRevise={onRevise} />}
      {isLatest && c.choices.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {c.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              disabled={disabled}
              onClick={() => onChoice(choice)}
              className="rounded-full border border-primary px-3.5 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft disabled:opacity-40"
            >
              {choice}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function ProposalCard({
  content,
  disabled,
  onAdopt,
  onRevise,
}: {
  content: AssistantContent;
  disabled: boolean;
  onAdopt: (index: number) => void;
  onRevise: (title: string) => void;
}) {
  const p = content.proposal!;
  const adopted = content.adopted ?? null;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface2 p-4 max-sm:p-3" aria-label={`${sectionLabel(p.section)}の AI の案`}>
      <p className="flex items-center gap-2 text-sm">
        <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary">AI の案</span>
        <b>{sectionLabel(p.section)}</b>
        <span className="text-xs text-muted">選んだ案だけが設計に保存されます</span>
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
        {p.options.map((o, i) => {
          const isRec = i === p.recommended;
          const isAdopted = adopted === i;
          return (
            <article key={i} className={`flex flex-col gap-2.5 rounded-lg border bg-surface p-4 text-sm ${isAdopted || (adopted === null && isRec) ? "border-primary" : "border-border"}`}>
              <header className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-bold">{o.title}</h3>
                {isRec && <span className="text-xs font-bold text-primary">おすすめ</span>}
              </header>
              {o.summary && <p className="leading-[1.7]">{o.summary}</p>}
              <dl className="flex flex-col gap-1.5 border-t border-line pt-2.5">
                {describeSection(p.section, o.value).map((row) => (
                  <div key={row.label}>
                    <dt className="text-xs text-muted">{row.label}</dt>
                    <dd className="leading-[1.7] whitespace-pre-wrap">{row.text}</dd>
                  </div>
                ))}
              </dl>
              {(o.pros.length > 0 || o.cons.length > 0) && (
                <div className="grid grid-cols-2 gap-2 border-t border-line pt-2.5 text-xs leading-[1.7] max-sm:grid-cols-1">
                  <div>
                    <p className="font-bold text-success">長所</p>
                    <ul>{o.pros.map((x) => <li key={x}>・{x}</li>)}</ul>
                  </div>
                  <div>
                    <p className="font-bold text-muted">短所</p>
                    <ul>{o.cons.map((x) => <li key={x}>・{x}</li>)}</ul>
                  </div>
                </div>
              )}
              <div className="mt-auto pt-1">
                {isAdopted ? (
                  <p className="font-bold text-success">✓ 採用しました</p>
                ) : (
                  <Button size="sm" variant={isRec ? "primary" : "secondary"} disabled={disabled} onClick={() => onAdopt(i)} className="w-full">
                    この案にする
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {p.reason && (
        <p className="text-sm leading-[1.7]">
          <span className="font-bold text-primary">おすすめの理由: </span>
          {p.reason}
        </p>
      )}
      {adopted === null && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {p.options.map((o) => (
            <button key={o.title} type="button" disabled={disabled} onClick={() => onRevise(o.title)} className="text-sm font-semibold text-primary hover:underline disabled:opacity-40">
              「{o.title}」を直したい
            </button>
          ))}
        </div>
      )}
      {adopted !== null && (
        <p className="text-xs text-muted">
          保存した中身は、設計の画面でいつでも手で直せます。
        </p>
      )}
    </section>
  );
}
