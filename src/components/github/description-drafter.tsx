"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { AppDescriptionDraft } from "@/lib/ai/app-description";
import { adoptDescription, draftDescription, refineDescription } from "@/lib/github/actions";

// リポジトリを読んで AI がアプリの紹介文（どんなアプリか）を下書きし、利用者が質問に答えたり直したりして採用する
export function DescriptionDrafter({ projectId, aiEnabled, hasAudience }: { projectId: string; aiEnabled: boolean; hasAudience: boolean }) {
  const [draft, setDraft] = useState<AppDescriptionDraft | null>(null);
  const [filesRead, setFilesRead] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [useAudience, setUseAudience] = useState(!hasAudience);
  const [answers, setAnswers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [working, setWorking] = useState<"draft" | "refine" | "adopt" | null>(null);

  function apply(d: AppDescriptionDraft, text: string) {
    setDraft(d);
    setDescription(text);
    setAudience(d.audience);
    setAnswers(d.questions.map(() => ""));
  }

  function run(kind: "draft" | "refine" | "adopt", fn: () => Promise<void>) {
    setError(null);
    setWorking(kind);
    startTransition(async () => {
      await fn();
      setWorking(null);
    });
  }

  const draftNow = () =>
    run("draft", async () => {
      const res = await draftDescription(projectId);
      if (res.error || !res.draft) return setError(res.error ?? "うまくいきませんでした。");
      apply(res.draft, res.description ?? "");
      setFilesRead(res.filesRead ?? []);
    });

  const answered = draft?.questions.map((q, i) => ({ question: q.question, answer: answers[i] ?? "" })).filter((a) => a.answer.trim()) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-[1.8] text-muted">
        AI がリポジトリを読んで、アプリの<b className="text-fg">紹介文（どんなアプリか）</b>を下書きします。紹介文は、アカウント設計の相談や、投稿のネタを考えるときの材料になります。確かめて直してから使えます。
      </p>
      {!draft && (
        <div className="flex flex-wrap items-center gap-3">
          {aiEnabled ? (
            <Button onClick={draftNow} disabled={pending}>
              リポジトリを読んで、紹介文を下書きする
            </Button>
          ) : (
            <span className="flex items-center gap-2">
              <Button disabled>リポジトリを読んで、紹介文を下書きする</Button>
              <span className="text-xs text-muted">準備中</span>
            </span>
          )}
          {working === "draft" && <span role="status" className="text-sm text-muted">読むファイルを選んで、紹介文を書いています…（30〜90 秒ほど）</span>}
        </div>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {draft && (
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface2 p-5 max-sm:p-4">
          <p className="flex items-center gap-2 text-sm">
            <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary">AI の案</span>
            <span className="text-muted">使うまでは保存されません。</span>
          </p>

          {draft.questions.length > 0 && (
            <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4" aria-labelledby="draft-questions">
              <h3 id="draft-questions" className="text-[14px] font-bold">
                紹介文をよくするための質問
                <span className="ml-2 text-xs font-normal text-muted">答えると、AI が紹介文を書き直します（答えなくても使えます）</span>
              </h3>
              {draft.questions.map((q, i) => (
                <div key={q.question} className="flex flex-col gap-2">
                  <label htmlFor={`answer-${i}`} className="text-[14px] leading-[1.7]">
                    {q.question}
                  </label>
                  {q.choices.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {q.choices.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setAnswers((a) => a.map((x, j) => (j === i ? c : x)))}
                          className={`rounded-full border px-3 py-1 text-sm font-semibold ${answers[i] === c ? "border-primary bg-primary-soft text-primary" : "border-border text-fg hover:border-primary"}`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                  <Input id={`answer-${i}`} value={answers[i] ?? ""} maxLength={1000} onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))} placeholder="自分の言葉で答えても大丈夫です" />
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending || answered.length === 0}
                  onClick={() =>
                    run("refine", async () => {
                      const res = await refineDescription(projectId, draft, answered);
                      if (res.error || !res.draft) return setError(res.error ?? "うまくいきませんでした。");
                      apply(res.draft, res.description ?? "");
                    })
                  }
                >
                  答えて書き直す
                </Button>
                <span className="text-xs text-muted">{working === "refine" ? "書き直しています…" : "下の紹介文を手で直していた場合は、書き直した内容に置き換わります"}</span>
              </div>
            </section>
          )}

          <Field label="紹介文（どんなアプリか）" htmlFor="draft-description" hint="プロジェクトの「どんなアプリか」に入ります。アカウント設計の AI や、投稿のネタを考えるときの材料になります">
            <Textarea id="draft-description" rows={6} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          {draft.audience && (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-[14px] font-bold">
                <input type="checkbox" checked={useAudience} onChange={(e) => setUseAudience(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                届けたい相手にも入れる
                {hasAudience && <span className="text-xs font-normal text-muted">（いま入っている内容を置き換えます）</span>}
              </label>
              {useAudience && <Textarea aria-label="届けたい相手" rows={2} maxLength={1000} value={audience} onChange={(e) => setAudience(e.target.value)} />}
            </div>
          )}

          {filesRead.length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">AI が読んだファイル（{filesRead.length} 件）</summary>
              <ul className="mt-1 break-all">{filesRead.map((f) => <li key={f}>{f}</li>)}</ul>
            </details>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              disabled={pending || !description.trim()}
              onClick={() =>
                run("adopt", async () => {
                  const res = await adoptDescription(projectId, { description, audience: draft.audience && useAudience && audience.trim() ? audience : null });
                  if (res?.error) setError(res.error);
                })
              }
            >
              この紹介文をプロジェクトに使う
            </Button>
            <Button variant="text" disabled={pending} onClick={draftNow}>
              リポジトリを読み直して、下書きし直す
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
