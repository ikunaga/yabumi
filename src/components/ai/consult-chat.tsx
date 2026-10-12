"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Term } from "@/components/ui/term";
import { sendConsultMessage } from "@/lib/ai/consult-actions";
import type { ConsultAssistantContent, ConsultMessage, ConsultTopic } from "@/lib/ai/consult";
import type { ConsultAction } from "@/lib/ai/consult-schema";
import { CONSULT_TOPIC_META } from "@/lib/ai/consult-topics";
import { sectionLabel } from "@/lib/ai/plan-coach-prompt";
import { KPIS } from "@/lib/metrics/kpis";
import { describeSection } from "@/lib/plan/describe";
import { formatValue } from "@/lib/roadmap/schema";
import { SNS } from "@/lib/sns";

type Input = { kind: "start"; topic: ConsultTopic } | { kind: "text"; text: string } | { kind: "adopt"; messageId: string; actionIndex: number };

const TOPIC_BUTTONS = (Object.keys(CONSULT_TOPIC_META) as ConsultTopic[]).map((topic) => ({ topic, label: CONSULT_TOPIC_META[topic].button }));

const KIND_LABEL: Record<ConsultAction["kind"], ReactNode> = {
  plan_section: "アカウント設計の直し",
  goal: (
    <>
      目標（<Term k="kgi" />）と週の目標
    </>
  ),
  roadmap_items: "ロードマップのやること",
  post_draft: "投稿の下書き",
};

// AI と相談（F09、docs/architecture.md の 4.23）の会話の画面
export function ConsultChat({
  projectId,
  threadId: initialThreadId,
  messages,
  initialTopic,
}: {
  projectId: string;
  threadId: string | null;
  messages: ConsultMessage[];
  // ロードマップの「AI と作る」などから来たときの相談
  initialTopic: ConsultTopic | null;
}) {
  const router = useRouter();
  const [threadId, setThreadId] = useState(initialThreadId);
  const [text, setText] = useState("");
  const [sentText, setSentText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const started = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function send(input: Input) {
    setError(null);
    // 返事を待つ間も、何を頼んだかが見えるように、利用者の発言を先に吹き出しで出す（入口のボタンから始めたときも）
    setSentText(input.kind === "text" ? input.text : input.kind === "start" ? CONSULT_TOPIC_META[input.topic].button : null);
    startTransition(async () => {
      const res = await sendConsultMessage(projectId, input.kind === "start" ? null : threadId, input);
      if (res.redirect) {
        router.push(res.redirect);
        return;
      }
      if (res.threadId && res.threadId !== threadId) {
        setThreadId(res.threadId);
        router.replace(`/projects/${projectId}/consult?thread=${res.threadId}`, { scroll: false });
      }
      if (res.ok) {
        if (input.kind === "text") setText("");
      } else {
        setError(res.message ?? "うまくいきませんでした。");
      }
      setSentText(null);
      router.refresh();
    });
  }

  // ロードマップの画面などから来たら、その相談を始める（1 回だけ）
  useEffect(() => {
    if (!initialTopic || started.current) return;
    started.current = true;
    send({ kind: "start", topic: initialTopic });
    // 最初の 1 回だけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  function submitText() {
    const t = text.trim();
    if (!t || pending) return;
    send({ kind: "text", text: t });
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 && !pending && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4">
          <p className="text-[14px] leading-[1.8]">
            運用の悩みを相談できます。AI はアカウント設計・最近の投稿・数字・ロードマップを見たうえで、次の一手を出します。提案は「これにする」を押したものだけが、設計やロードマップに入ります。
          </p>
          <div className="flex flex-wrap gap-2">
            {TOPIC_BUTTONS.map((t) => (
              <button
                key={t.topic}
                type="button"
                onClick={() => send({ kind: "start", topic: t.topic })}
                className="rounded-full border border-primary px-3.5 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft"
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">下の欄に、自由に書いて相談することもできます。</p>
        </div>
      )}

      <ol className="flex flex-col gap-4" aria-live="polite">
        {messages.map((m) =>
          m.role === "assistant" ? (
            <AssistantBubble
              key={m.id}
              message={m}
              isLatest={m.id === lastAssistant?.id}
              disabled={pending}
              onChoice={(c) => send({ kind: "text", text: c })}
              onAdopt={(i) => send({ kind: "adopt", messageId: m.id, actionIndex: i })}
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

      <div className="sticky bottom-0 z-[5] -mx-12 flex flex-col gap-2 border-t border-border bg-surface px-12 py-3 max-lg:-mx-8 max-lg:px-8 max-sm:bottom-[72px] max-sm:-mx-4 max-sm:px-4">
        <label htmlFor="consult-input" className="sr-only">
          AI への相談
        </label>
        <textarea
          id="consult-input"
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
          placeholder="悩みや、聞きたいことを書いてください（⌘ / Ctrl + Enter で送る）"
          className="w-full resize-none rounded-md border border-input bg-surface px-3.5 py-2.5 text-[14px] outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
        />
        <div className="flex items-center">
          <Button className="ml-auto" size="sm" disabled={pending || !text.trim()} onClick={submitText}>
            送る
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: Extract<ConsultMessage, { role: "user" }> }) {
  const c = message.content;
  if (c.kind === "adopt") {
    return <li className="text-center text-sm text-success">✓ 提案「{c.title}」を採用しました（{KIND_LABEL[c.actionKind]}）</li>;
  }
  const text = c.kind === "text" ? c.text : (CONSULT_TOPIC_META[c.topic]?.button ?? "");
  return (
    <li className="flex justify-end">
      <p className="max-w-[80%] rounded-lg bg-primary-soft px-4 py-2.5 text-[14px] leading-[1.7] whitespace-pre-wrap">{text}</p>
    </li>
  );
}

function AssistantBubble({
  message,
  isLatest,
  disabled,
  onChoice,
  onAdopt,
}: {
  message: Extract<ConsultMessage, { role: "assistant" }>;
  isLatest: boolean;
  disabled: boolean;
  onChoice: (choice: string) => void;
  onAdopt: (index: number) => void;
}) {
  const c: ConsultAssistantContent = message.content;
  const adopted = c.adopted ?? [];
  return (
    <li className="flex flex-col gap-3">
      <div className="max-w-[88%] rounded-lg border border-border bg-surface px-4 py-3 max-sm:max-w-full">
        <p className="mb-1 text-xs font-bold text-primary">AI</p>
        <p className="text-[14px] leading-[1.8] whitespace-pre-wrap">{c.message}</p>
      </div>
      {c.actions.map((a, i) => (
        <ActionCard key={i} action={a} adopted={adopted.includes(i)} disabled={disabled} onAdopt={() => onAdopt(i)} />
      ))}
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

function weekText(week: number): string {
  if (week === 0) return "今週";
  if (week === 1) return "来週";
  return `${week} 週後`;
}

function ActionCard({ action: a, adopted, disabled, onAdopt }: { action: ConsultAction; adopted: boolean; disabled: boolean; onAdopt: () => void }) {
  return (
    <section className="flex max-w-[88%] flex-col gap-2.5 rounded-lg border border-border bg-surface2 p-4 text-sm max-sm:max-w-full max-sm:p-3" aria-label={`AI の提案: ${a.title}`}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary">AI の提案</span>
        <span className="text-xs text-muted">{KIND_LABEL[a.kind]}</span>
      </p>
      <h3 className="text-[15px] font-bold">{a.title}</h3>
      {a.reason && <p className="leading-[1.7] text-muted">{a.reason}</p>}
      <div className="rounded-md border border-line bg-surface p-3 leading-[1.7]">
        {a.kind === "plan_section" && (
          <dl className="flex flex-col gap-1.5">
            <dt className="text-xs font-bold">{sectionLabel(a.section)}</dt>
            {describeSection(a.section, a.value).map((row) => (
              <div key={row.label}>
                <dt className="text-xs text-muted">{row.label}</dt>
                <dd className="whitespace-pre-wrap">{row.text}</dd>
              </div>
            ))}
          </dl>
        )}
        {a.kind === "goal" && (
          <div className="flex flex-col gap-1">
            <p className="font-bold">{a.kgi.statement}</p>
            <p className="text-xs text-muted">
              {KPIS[a.kgi.kpi].label}を {formatValue(a.kgi.kpi, a.kgi.target)}、期限 {a.kgi.deadline}
            </p>
            {a.kpiTargets.length > 0 && (
              <ul className="text-xs">
                {a.kpiTargets.map((t) => (
                  <li key={t.kpi}>
                    ・{KPIS[t.kpi].label}: 1 週に {formatValue(t.kpi, t.per_week)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {a.kind === "roadmap_items" && (
          <ul className="flex flex-col gap-1">
            {a.items.map((item, i) => (
              <li key={i}>
                <span className="mr-2 text-xs text-muted">{weekText(item.week)}</span>
                {item.title}
                {item.kpi && item.target !== null && <span className="ml-2 text-xs text-muted">（{KPIS[item.kpi].label} {formatValue(item.kpi, item.target)}）</span>}
              </li>
            ))}
          </ul>
        )}
        {a.kind === "post_draft" && (
          <div className="flex flex-col gap-1">
            {a.sns && <p className="text-xs text-muted">{SNS[a.sns].label} 向け</p>}
            <p className="line-clamp-6 whitespace-pre-wrap">{a.text}</p>
          </div>
        )}
      </div>
      <div>
        {adopted ? (
          <p className="font-bold text-success">✓ 採用しました</p>
        ) : (
          <Button size="sm" disabled={disabled} onClick={onAdopt}>
            {a.kind === "post_draft" ? "下書きにする" : "これにする"}
          </Button>
        )}
      </div>
    </section>
  );
}
