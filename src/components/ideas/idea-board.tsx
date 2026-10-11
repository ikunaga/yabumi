"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import { adoptIdea, generateIdeas, refineIdeas } from "@/lib/ai/post-ideas-actions";
import type { IdeasThread, PostIdea } from "@/lib/ai/post-ideas";
import { IDEA_PERIODS, type IdeaPeriod } from "@/lib/github/commit-reader";
import { ISSUE_LABEL, SNS, checkTarget, type SnsKey } from "@/lib/sns";

const PERIOD_LABEL: Record<IdeaPeriod, string> = { 3: "3 日", 7: "1 週間", 14: "2 週間", 30: "1 か月" };

type Props = {
  projectId: string;
  repoFullName: string;
  aiEnabled: boolean;
  snsOptions: SnsKey[];
  maxSns: number;
  defaultSns: SnsKey[];
  defaultDays: IdeaPeriod;
  thread: IdeasThread | null;
};

// 最近のコミットから AI がネタを出し、利用者が質問に答えたり、ネタを選んで下書きにしたりする
export function IdeaBoard({ projectId, repoFullName, aiEnabled, snsOptions, maxSns, defaultSns, defaultDays, thread }: Props) {
  const [days, setDays] = useState<IdeaPeriod>(defaultDays);
  const [sns, setSns] = useState<SnsKey[]>(defaultSns);
  const [answers, setAnswers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<"generate" | "refine" | `adopt-${number}` | null>(null);
  const [pending, startTransition] = useTransition();

  function run(kind: NonNullable<typeof working>, fn: () => Promise<{ error?: string } | undefined>) {
    setError(null);
    setWorking(kind);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else if (kind === "generate" || kind === "refine") setAnswers([]);
      setWorking(null);
    });
  }

  function toggleSns(k: SnsKey) {
    setSns((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : cur.length >= maxSns ? cur : [...cur, k]));
  }

  const latest = thread?.latest.content;
  const questions = latest?.questions ?? [];
  const answered = questions.map((q, i) => ({ question: q.question, answer: answers[i] ?? "" })).filter((a) => a.answer.trim());

  return (
    <div className="flex flex-col gap-6 max-sm:gap-4">
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 max-sm:p-4" aria-labelledby="ideas-form">
        <h2 id="ideas-form" className="text-base font-bold">
          {thread ? "新しくネタを出す" : "コミットを読んで、ネタを出す"}
        </h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[14px] font-bold">
            どのくらい前までのコミットを読むか
          </legend>
          <div className="flex flex-wrap gap-2">
            {IDEA_PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={days === p}
                onClick={() => setDays(p)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${days === p ? "border-primary bg-primary-soft text-primary" : "border-border text-fg hover:border-primary"}`}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[14px] font-bold">
            下書きを書く SNS<span className="ml-2 text-xs font-normal text-muted">{maxSns} つまで。SNS ごとに長さと書き方を変えます</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {snsOptions.map((k) => (
              <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${sns.includes(k) ? "border-primary bg-primary-soft text-primary" : "border-border text-fg hover:border-primary"}`}>
                <input type="checkbox" className="sr-only" checked={sns.includes(k)} onChange={() => toggleSns(k)} />
                {SNS[k].label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          {aiEnabled ? (
            <Button disabled={pending || sns.length === 0} onClick={() => run("generate", () => generateIdeas(projectId, days, sns))}>
              コミットを読んで、ネタを出す
            </Button>
          ) : (
            <span className="flex items-center gap-2">
              <Button disabled>コミットを読んで、ネタを出す</Button>
              <span className="text-xs text-muted">準備中</span>
            </span>
          )}
          {working === "generate" ? (
            <span role="status" className="text-sm text-muted">
              コミットを読んで、ネタを考えています…（30〜90 秒ほど）
            </span>
          ) : (
            <span className="text-xs text-muted">1 回あたり 20〜40 円ほどの AI の費用がかかります（月の上限の中で数えます）</span>
          )}
        </div>
      </section>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {thread && latest && (
        <section className="flex flex-col gap-4" aria-labelledby="ideas-result">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="ideas-result" className="text-lg font-bold">
              ネタの案
            </h2>
            <span className="text-sm text-muted">
              直近 {PERIOD_LABEL[thread.request.days as IdeaPeriod] ?? `${thread.request.days} 日`}のコミット {thread.request.commitCount} 件から
              {thread.answered && "・あなたの答えを反映"}
            </span>
          </div>
          <p className="flex items-center gap-2 text-sm">
            <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary">AI の案</span>
            <span className="text-muted">気に入ったネタを選ぶと、投稿の下書きになります。文面はそのあと自由に直せます。</span>
          </p>

          {questions.length > 0 && (
            <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface2 p-5 max-sm:p-4" aria-labelledby="idea-questions">
              <h3 id="idea-questions" className="text-[14px] font-bold">
                ネタをよくするための質問
                <span className="ml-2 text-xs font-normal text-muted">コミットだけではわからないことです。答えると、AI がネタを出し直します（答えなくても使えます）</span>
              </h3>
              {questions.map((q, i) => (
                <div key={q.question} className="flex flex-col gap-2">
                  <label htmlFor={`idea-answer-${i}`} className="text-[14px] leading-[1.7]">
                    {q.question}
                  </label>
                  {q.choices.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {q.choices.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setAnswers((a) => questions.map((_, j) => (j === i ? c : (a[j] ?? ""))))}
                          className={`rounded-full border px-3 py-1 text-sm font-semibold ${answers[i] === c ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-fg hover:border-primary"}`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                  <Input
                    id={`idea-answer-${i}`}
                    value={answers[i] ?? ""}
                    maxLength={1000}
                    onChange={(e) => setAnswers((a) => questions.map((_, j) => (j === i ? e.target.value : (a[j] ?? ""))))}
                    placeholder="自分の言葉で答えても大丈夫です"
                  />
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" disabled={pending || answered.length === 0} onClick={() => run("refine", () => refineIdeas(projectId, thread.threadId, answered))}>
                  答えて、ネタを出し直す
                </Button>
                {working === "refine" && (
                  <span role="status" className="text-xs text-muted">
                    出し直しています…
                  </span>
                )}
              </div>
            </section>
          )}

          <ol className="flex flex-col gap-4">
            {latest.ideas.map((idea, i) => (
              <IdeaCard
                key={`${thread.latest.messageId}-${i}`}
                idea={idea}
                repoFullName={thread.request.repo || repoFullName}
                adoptedPostId={latest.adopted?.[String(i)] ?? null}
                projectId={projectId}
                disabled={pending}
                saving={working === `adopt-${i}`}
                onAdopt={() => run(`adopt-${i}`, () => adoptIdea(projectId, thread.latest.messageId, i))}
              />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function IdeaCard({
  idea,
  repoFullName,
  adoptedPostId,
  projectId,
  disabled,
  saving,
  onAdopt,
}: {
  idea: PostIdea;
  repoFullName: string;
  adoptedPostId: string | null;
  projectId: string;
  disabled: boolean;
  saving: boolean;
  onAdopt: () => void;
}) {
  return (
    <li className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 max-sm:p-4">
      <div className="flex flex-col gap-1.5">
        {idea.pillar && (
          <span className="w-fit rounded-full bg-primary-soft px-2.5 py-1 text-xs leading-none font-bold text-primary">柱: {idea.pillar}</span>
        )}
        <h3 className="text-base font-bold">{idea.title}</h3>
        {idea.angle && <p className="text-sm leading-[1.8] text-muted">{idea.angle}</p>}
      </div>

      <div className="flex flex-col gap-3">
        {idea.drafts.map((d) => {
          const check = checkTarget(d.sns, d.text);
          const tooLong = check.issues.includes("too_long");
          return (
            <div key={d.sns} className="flex flex-col gap-1.5 rounded-md border border-line bg-surface2 px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-bold">{SNS[d.sns].label}</span>
                <span className={tooLong ? "font-bold text-danger" : "text-muted"}>
                  {check.length.toLocaleString("ja-JP")}
                  {check.maxLength !== null && ` / ${check.maxLength.toLocaleString("ja-JP")}`}
                  {tooLong && `（${ISSUE_LABEL.too_long}。下書きにしてから短くできます）`}
                </span>
              </div>
              <p className="text-[14px] leading-[1.8] whitespace-pre-wrap">{d.text}</p>
            </div>
          );
        })}
      </div>

      {idea.commits.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">元にしたコミット（{idea.commits.length} 件）</summary>
          <ul className="mt-2 flex flex-col gap-1.5 leading-[1.7]">
            {idea.commits.map((c) => (
              <li key={c.sha}>
                {c.note}{" "}
                <a href={`https://github.com/${repoFullName}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline">
                  {c.sha.slice(0, 7)}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {adoptedPostId ? (
          <>
            <span className="text-sm font-bold text-success">✓ 下書きにしました</span>
            <Link href={`/projects/${projectId}/posts/${adoptedPostId}`} className="text-sm font-semibold text-primary hover:underline">
              下書きを開く
            </Link>
          </>
        ) : (
          <Button size="sm" disabled={disabled} onClick={onAdopt}>
            {saving ? "下書きにしています…" : "このネタで下書きをつくる"}
          </Button>
        )}
      </div>
    </li>
  );
}
