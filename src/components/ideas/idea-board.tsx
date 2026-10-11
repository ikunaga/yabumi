"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { DeleteThreadButton } from "@/components/ai/delete-thread-button";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/field";
import { adoptIdea, generateIdeas, refineIdeas } from "@/lib/ai/post-ideas-actions";
import { IDEA_SOURCES, MAX_NEWS_CHARS, needsFillIn, type IdeaQuestion, type IdeaSource, type IdeasThread, type PostIdea } from "@/lib/ai/post-ideas";
import { IDEA_PERIODS, type IdeaPeriod } from "@/lib/github/commit-reader";
import { ISSUE_LABEL, SNS, checkTarget, type SnsKey } from "@/lib/sns";

const PERIOD_LABEL: Record<IdeaPeriod, string> = { 3: "3 日", 7: "1 週間", 14: "2 週間", 30: "1 か月" };

// 材料の選び方。素人が選びやすいよう、向いている人と気をつけることを添える
const SOURCE_INFO: Record<IdeaSource, { title: string; summary: string; good: string; note: string; button: string; working: string; cost: string }> = {
  commits: {
    title: "最近の開発から（GitHub）",
    summary: "GitHub に記録した変更（コミット）を AI が読みます。",
    good: "入力がいらない。作った・直したことが、そのまま話の種になる",
    note: "コミットの文だけでは苦労や理由がわからず、あとで質問が出ることがある",
    button: "コミットを読んで、ネタを出す",
    working: "コミットを読んで、ネタを考えています…（30〜90 秒ほど）",
    cost: "1 回あたり 20〜40 円ほど",
  },
  news: {
    title: "最近のできごとから",
    summary: "3 つの質問に答えると、それを投稿の形に広げます。",
    good: "GitHub がなくても使える。自分の言葉なので、いちばん実感のこもった投稿になる",
    note: "どれか 1 つは答える必要がある（短くて大丈夫）",
    button: "このできごとからネタを出す",
    working: "ネタを考えています…（20〜60 秒ほど）",
    cost: "1 回あたり 10〜20 円ほど",
  },
  plan: {
    title: "アカウント設計から（入力なし）",
    summary: "投稿の柱と「どんなアプリか」から、柱ごとに 1 つずつ出します。",
    good: "何も書かなくてよい。いつ出しても古くならないネタがそろう",
    note: "最近の話は入らないので、ほかの材料と交互に使うのがおすすめ",
    button: "アカウント設計からネタを出す",
    working: "ネタを考えています…（20〜60 秒ほど）",
    cost: "1 回あたり 10〜20 円ほど",
  },
};

type Props = {
  projectId: string;
  // つないだリポジトリ（なければ null）。GitHub との連携が準備中なら githubReady が false
  repoFullName: string | null;
  githubReady: boolean;
  aiEnabled: boolean;
  snsOptions: SnsKey[];
  maxSns: number;
  defaultSns: SnsKey[];
  defaultDays: IdeaPeriod;
  defaultSource: IdeaSource;
  newsQuestions: IdeaQuestion[];
  thread: IdeasThread | null;
};

// 材料（最近のコミット・最近のできごと・アカウント設計）から AI がネタを出し、利用者が質問に答えたり、ネタを選んで下書きにしたりする
export function IdeaBoard({ projectId, repoFullName, githubReady, aiEnabled, snsOptions, maxSns, defaultSns, defaultDays, defaultSource, newsQuestions, thread }: Props) {
  const [source, setSource] = useState<IdeaSource>(defaultSource);
  const [days, setDays] = useState<IdeaPeriod>(defaultDays);
  const [news, setNews] = useState<string[]>(() => newsQuestions.map(() => ""));
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

  const info = SOURCE_INFO[source];
  const newsAnswered = newsQuestions.map((q, i) => ({ question: q.question, answer: news[i] ?? "" })).filter((a) => a.answer.trim());
  const commitsBlocked = source === "commits" && !repoFullName;
  const canGenerate = sns.length > 0 && !commitsBlocked && (source !== "news" || newsAnswered.length > 0);
  const input = source === "commits" ? { source, days } : source === "news" ? { source, news: newsAnswered } : { source };

  const latest = thread?.latest.content;
  const questions = latest?.questions ?? [];
  const answered = questions.map((q, i) => ({ question: q.question, answer: answers[i] ?? "" })).filter((a) => a.answer.trim());

  const pill = (on: boolean) => `rounded-full border px-3.5 py-1.5 text-sm font-semibold ${on ? "border-primary bg-primary-soft text-primary" : "border-border text-fg hover:border-primary"}`;

  return (
    <div className="flex flex-col gap-6 max-sm:gap-4">
      <section className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 max-sm:p-4" aria-labelledby="ideas-form">
        <h2 id="ideas-form" className="text-base font-bold">
          {thread ? "新しくネタを出す" : "何からネタを出すか選ぶ"}
        </h2>

        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">ネタの材料</legend>
          <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
            {IDEA_SOURCES.map((k) => {
              const s = SOURCE_INFO[k];
              const on = source === k;
              return (
                <label key={k} className={`flex cursor-pointer flex-col gap-1.5 rounded-md border p-3.5 text-sm leading-[1.7] ${on ? "border-primary bg-primary-soft" : "border-border hover:border-primary"}`}>
                  <span className="flex items-center gap-2 font-bold">
                    <input type="radio" name="idea-source" value={k} checked={on} onChange={() => setSource(k)} className="size-4 accent-[var(--primary)]" />
                    {s.title}
                  </span>
                  <span>{s.summary}</span>
                  <span className="text-xs text-muted">よいところ: {s.good}</span>
                  <span className="text-xs text-muted">気をつけること: {s.note}</span>
                  {k === "commits" && !repoFullName && <span className="text-xs font-semibold text-muted">GitHub をつなぐと使えます</span>}
                </label>
              );
            })}
          </div>
        </fieldset>

        {source === "commits" &&
          (repoFullName ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[14px] font-bold">
                どのくらい前までのコミットを読むか
                <span className="ml-2 text-xs font-normal text-muted">
                  読むリポジトリ: <span className="break-all">{repoFullName}</span>（
                  <Link href={`/projects/${projectId}/github`} className="text-primary hover:underline">
                    変える
                  </Link>
                  ）
                </span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {IDEA_PERIODS.map((p) => (
                  <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)} className={pill(days === p)}>
                    {PERIOD_LABEL[p]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">.env や鍵などのファイルは読まず、コミットの中身は矢書に残しません。</p>
            </fieldset>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-line bg-surface2 px-4 py-3 text-sm leading-[1.8]">
              <p>GitHub のリポジトリをつなぐと、最近のコミットからネタを出せます。読むだけで、書き込みはしません。非公開のリポジトリも読めます。</p>
              {githubReady ? (
                <Link href={`/projects/${projectId}/github`} className="w-fit font-semibold text-primary hover:underline">
                  GitHub をつなぐ
                </Link>
              ) : (
                <span className="text-xs text-muted">GitHub をつなぐ（準備中）</span>
              )}
            </div>
          ))}

        {source === "news" && (
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-[14px] font-bold">
              最近のできごと<span className="ml-2 text-xs font-normal text-muted">どれか 1 つに答えれば出せます。例を押してから書き足しても大丈夫です</span>
            </legend>
            {newsQuestions.map((q, i) => (
              <div key={q.question} className="flex flex-col gap-2">
                <label htmlFor={`idea-news-${i}`} className="text-[14px] leading-[1.7]">
                  {q.question}
                </label>
                <div className="flex flex-wrap gap-2">
                  {q.choices.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNews((cur) => cur.map((x, j) => (j === i ? (x.trim() ? `${x}${x.endsWith("。") ? "" : "。"}${c}` : c) : x)))}
                      className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-fg hover:border-primary"
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <Textarea
                  id={`idea-news-${i}`}
                  rows={2}
                  maxLength={MAX_NEWS_CHARS}
                  value={news[i] ?? ""}
                  onChange={(e) => setNews((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder="例: 通知が 2 回届く不具合を直した。原因は時差の計算だった"
                />
              </div>
            ))}
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[14px] font-bold">
            下書きを書く SNS<span className="ml-2 text-xs font-normal text-muted">{maxSns} つまで。SNS ごとに長さと書き方を変えます</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {snsOptions.map((k) => (
              <label key={k} className={`flex cursor-pointer items-center gap-2 ${pill(sns.includes(k))}`}>
                <input type="checkbox" className="sr-only" checked={sns.includes(k)} onChange={() => toggleSns(k)} />
                {SNS[k].label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          {aiEnabled ? (
            <Button disabled={pending || !canGenerate} onClick={() => run("generate", () => generateIdeas(projectId, input, sns))}>
              {info.button}
            </Button>
          ) : (
            <span className="flex items-center gap-2">
              <Button disabled>{info.button}</Button>
              <span className="text-xs text-muted">準備中</span>
            </span>
          )}
          {working === "generate" ? (
            <span role="status" className="text-sm text-muted">
              {info.working}
            </span>
          ) : (
            <span className="text-xs text-muted">{info.cost}の AI の費用がかかります（月の上限の中で数えます）</span>
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
              {sourceLabel(thread)}
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
                <span className="ml-2 text-xs font-normal text-muted">いまわかっていることだけでは書けないところです。答えると、AI がネタを出し直します（答えなくても使えます）</span>
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
                repoFullName={thread.request.repo || repoFullName || ""}
                adoptedPostId={latest.adopted?.[String(i)] ?? null}
                projectId={projectId}
                disabled={pending}
                saving={working === `adopt-${i}`}
                onAdopt={() => run(`adopt-${i}`, () => adoptIdea(projectId, thread.latest.messageId, i))}
              />
            ))}
          </ol>

          <DeleteThreadButton
            projectId={projectId}
            threadId={thread.threadId}
            backPath={`/projects/${projectId}/ideas`}
            keeps="このネタから下書きにした投稿は残ります。前に出したネタがあれば、それが出ます。"
          />
        </section>
      )}
    </div>
  );
}

// 結果の見出しに添える、何から出したか
function sourceLabel(thread: IdeasThread): string {
  const r = thread.request;
  if (r.source === "news") return "最近のできごとから";
  if (r.source === "plan") return "アカウント設計から";
  const days = r.days ?? 0;
  return `直近 ${PERIOD_LABEL[days as IdeaPeriod] ?? `${days} 日`}のコミット ${r.commitCount ?? 0} 件から`;
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

      {idea.drafts.some((d) => needsFillIn(d.text)) && (
        <p className="text-sm leading-[1.7]">
          <span className="font-bold text-signal">● 書き換えが必要</span>
          <span className="text-muted"> 【】で囲んだところは、あなたにしか書けない部分です。下書きにしたあと、自分の言葉に書き換えてから送ってください。</span>
        </p>
      )}

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
