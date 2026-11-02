"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { DeleteThreadButton } from "@/components/ai/delete-thread-button";
import { Button, ButtonLink, NotReadyButton } from "@/components/ui/button";
import { Badge, chipClass } from "@/components/ui/chip";
import { HelpTip } from "@/components/ui/help";
import { SnsMark } from "@/components/ui/marks";
import { ErrorBanner } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/field";
import { Steps } from "@/components/ui/steps";
import { adoptIdea, generateIdeas, refineIdeas } from "@/lib/ai/post-ideas-actions";
import { MAX_NEWS_CHARS, needsFillIn, type IdeaNoteMaterial, type IdeaQuestion, type IdeaSource, type IdeasThread, type PostIdea } from "@/lib/ai/post-ideas";
import { IDEA_PERIODS, type IdeaPeriod } from "@/lib/github/commit-reader";
import { IDEA_STEPS, type IdeaStep, canGoIdeaStep, initialIdeaStep, visibleIdeaStep } from "@/lib/ideas/steps";
import { MAX_NOTES_FOR_IDEAS } from "@/lib/notes/rules";
import { SNS, checkTarget, type SnsKey } from "@/lib/sns";
import { formatShort } from "@/lib/time";

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
    good: "自分の言葉なので、いちばん実感のこもった投稿になる。答えの例を押すだけでも書ける",
    note: "どれか 1 つは答える必要がある（短くて大丈夫）",
    button: "このできごとからネタを出す",
    working: "ネタを考えています…（20〜60 秒ほど）",
    cost: "1 回あたり 10〜20 円ほど",
  },
  notes: {
    title: "ネタ帳から",
    summary: "ネタ帳に書き留めたメモを選ぶと、それを投稿の形に広げます。",
    good: "生活の中で気づいたことが、そのまま実感のこもった投稿になる",
    note: "メモに書いたことだけを使う。AI に送るのはメモの文だけで、写真は送らない（写真は下書きに添える）",
    button: "選んだメモからネタを出す",
    working: "ネタを考えています…（20〜60 秒ほど）",
    cost: "1 回あたり 10〜20 円ほど",
  },
  plan: {
    title: "アカウント設計から（入力なし）",
    summary: "投稿の柱と、プロジェクトの説明から、柱ごとに 1 つずつ出します。",
    good: "何も書かなくてよい。いつ出しても古くならないネタがそろう",
    note: "最近の話は入らないので、ほかの材料と交互に使うのがおすすめ",
    button: "アカウント設計からネタを出す",
    working: "ネタを考えています…（20〜60 秒ほど）",
    cost: "1 回あたり 10〜20 円ほど",
  },
};

// ② の見出し（材料ごとに、何を入れるか）
const STEP2_TITLE: Record<IdeaSource, string> = {
  commits: "読むコミットの期間と、SNS を選ぶ",
  news: "最近のできごとを書いて、SNS を選ぶ",
  notes: "使うメモと、SNS を選ぶ",
  plan: "SNS を選ぶ",
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
  // 最近のできごとの答えの欄に薄く出す例（種類ごと）
  newsExample: string;
  // 選べる材料（宣伝するものの種類で変わる。「最近の開発から（GitHub）」はアプリ・Web のサービスのときだけ）
  sources: IdeaSource[];
  // ネタ帳のまだ使っていないメモ（新しい順）と、ネタ帳の画面で選んできたメモ
  notes: { id: string; body: string; hasImage: boolean; createdAt: string }[];
  defaultNoteIds: string[];
  thread: IdeasThread | null;
  // 投稿の柱がまだ決まっていない（② に一言添える）
  noPillars: boolean;
};

// 材料（最近のコミット・最近のできごと・ネタ帳・アカウント設計）から AI がネタを出し、利用者が質問に答えたり、ネタを選んで下書きにしたりする。
// ① 材料を選ぶ → ② 中身を入れる → ③ ネタを選んで下書きにする の 3 つのステップに分け、いまいるステップの項目だけを出す（入れたものはステップを移っても残る）
export function IdeaBoard({ projectId, repoFullName, githubReady, aiEnabled, snsOptions, maxSns, defaultSns, defaultDays, defaultSource, newsQuestions, newsExample, sources, notes, defaultNoteIds, thread, noPillars }: Props) {
  const [step, setStep] = useState<IdeaStep>(() => initialIdeaStep({ hasThread: Boolean(thread), fromNotes: defaultNoteIds.length > 0 }));
  const [source, setSource] = useState<IdeaSource>(defaultSource);
  const [days, setDays] = useState<IdeaPeriod>(defaultDays);
  const [news, setNews] = useState<string[]>(() => newsQuestions.map(() => ""));
  const [sns, setSns] = useState<SnsKey[]>(defaultSns);
  const [noteIds, setNoteIds] = useState<string[]>(defaultNoteIds);
  const [answers, setAnswers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<"generate" | "refine" | `adopt-${number}` | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = visibleIdeaStep(step, Boolean(thread));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // ステップを移ったら、そのステップの見出しへ（読み上げと、スマホで上に戻すため）。開いたときは動かさない
  useEffect(() => {
    if (!moved.current) return;
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [shown]);

  function go(next: IdeaStep) {
    if (!canGoIdeaStep(next, Boolean(thread))) return;
    moved.current = true;
    setError(null);
    setStep(next);
  }

  function run(kind: NonNullable<typeof working>, fn: () => Promise<{ error?: string } | undefined>) {
    setError(null);
    setWorking(kind);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else if (kind === "generate" || kind === "refine") {
        setAnswers([]);
        // 出したネタ（③）へ
        if (kind === "generate") {
          moved.current = true;
          setStep(3);
        }
      }
      setWorking(null);
    });
  }

  function toggleSns(k: SnsKey) {
    setSns((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : cur.length >= maxSns ? cur : [...cur, k]));
  }

  const info = SOURCE_INFO[source];
  const newsAnswered = newsQuestions.map((q, i) => ({ question: q.question, answer: news[i] ?? "" })).filter((a) => a.answer.trim());
  const commitsBlocked = source === "commits" && !repoFullName;
  const pickedNotes = noteIds.filter((id) => notes.some((n) => n.id === id && n.body.trim()));
  const canGenerate = sns.length > 0 && !commitsBlocked && (source !== "news" || newsAnswered.length > 0) && (source !== "notes" || pickedNotes.length > 0);
  const input =
    source === "commits" ? { source, days } : source === "news" ? { source, news: newsAnswered } : source === "notes" ? { source, noteIds: pickedNotes } : { source };

  function toggleNote(id: string) {
    setNoteIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_NOTES_FOR_IDEAS ? cur : [...cur, id]));
  }

  const latest = thread?.latest.content;
  const questions = latest?.questions ?? [];
  const answered = questions.map((q, i) => ({ question: q.question, answer: answers[i] ?? "" })).filter((a) => a.answer.trim());

  const pill = (on: boolean) => chipClass({ on });
  const card = "flex flex-col gap-4 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4";
  const heading = "text-[18px] font-bold outline-none max-sm:text-[16px]";

  // 右の列: ①② は選んでいるものと前に出したネタ、③ は質問とやり直し（見本 B の 2 列）
  const side =
    shown === 3 && thread && latest ? (
      <div className="flex min-w-0 flex-col gap-4">
        {questions.length > 0 && (
          <section className={card} aria-labelledby="idea-questions">
            <div className="flex items-center gap-1.5">
              <h3 id="idea-questions" className="text-[18px] font-bold max-sm:text-[16px]">
                質問に答える
              </h3>
            </div>
            {questions.map((q, i) => (
              <div key={q.question} className="flex flex-col gap-2">
                <label htmlFor={`idea-answer-${i}`} className="text-[15px] leading-[1.7]">
                  {q.question}
                </label>
                {q.choices.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {q.choices.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={answers[i] === c}
                        onClick={() => setAnswers((a) => questions.map((_, j) => (j === i ? c : (a[j] ?? ""))))}
                        className={pill(answers[i] === c)}
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
                <span role="status" className="text-[13px] text-muted">
                  出し直しています…
                </span>
              )}
            </div>
          </section>
        )}
        <section className={card}>
          <Button variant="secondary" disabled={pending} onClick={() => go(1)} className="w-full">
            新しくネタを出す
          </Button>
          <DeleteThreadButton
            projectId={projectId}
            threadId={thread.threadId}
            backPath={`/projects/${projectId}/ideas`}
            keeps="このネタから下書きにした投稿は残ります。前に出したネタがあれば、それが出ます。"
          />
        </section>
      </div>
    ) : (
      <div className="flex min-w-0 flex-col gap-4">
        <section className={card} aria-label="選んでいるもの">
          <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2.5 text-[15px]">
            <dt className="text-muted">材料</dt>
            <dd className="font-bold">{info.title}</dd>
            {source === "commits" && repoFullName && (
              <>
                <dt className="text-muted">期間</dt>
                <dd>直近 {PERIOD_LABEL[days]}</dd>
              </>
            )}
            {source === "notes" && (
              <>
                <dt className="text-muted">メモ</dt>
                <dd className="num">{pickedNotes.length} 件</dd>
              </>
            )}
            {source === "news" && (
              <>
                <dt className="text-muted">答えた</dt>
                <dd className="num">
                  {newsAnswered.length} / {newsQuestions.length}
                </dd>
              </>
            )}
            <dt className="text-muted">SNS</dt>
            <dd className="flex flex-wrap gap-1">{sns.length ? sns.map((k) => <SnsMark key={k} sns={k} />) : <span className="text-faint">まだ選んでいません</span>}</dd>
            <dt className="text-muted">費用</dt>
            <dd className="text-muted">{info.cost.replace("1 回あたり ", "1 回 ")}</dd>
          </dl>
        </section>
        {thread && latest && (
          <section className={card} aria-labelledby="ideas-last">
            <div className="flex items-baseline justify-between gap-3">
              <h3 id="ideas-last" className="text-[18px] font-bold max-sm:text-[16px]">
                前に出したネタ
              </h3>
              <span className="num text-[15px] text-faint">{latest.ideas.length} 件</span>
            </div>
            <ul className="flex flex-col">
              {latest.ideas.slice(0, 4).map((idea, i) => (
                <li key={i} className="flex items-center gap-2 border-t border-line py-2 text-[15px] first:border-t-0">
                  <span className="min-w-0 flex-1 truncate">{idea.title}</span>
                  {latest.adopted?.[String(i)] && <span className="shrink-0 text-[13px] font-bold text-success">✓ 下書き</span>}
                </li>
              ))}
            </ul>
            <Button variant="secondary" size="sm" onClick={() => go(3)} className="self-start">
              前に出したネタを見る
            </Button>
          </section>
        )}
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <Steps label="ネタを出す段取り" steps={IDEA_STEPS} current={shown} canGo={(k) => canGoIdeaStep(k, Boolean(thread))} onGo={go} />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid grid-cols-[minmax(0,1.03fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          {shown === 1 && (
            <section className={card} aria-labelledby="ideas-step-1">
              <h2 id="ideas-step-1" ref={headingRef} tabIndex={-1} className={heading}>
                何からネタを出すか
              </h2>
              <fieldset>
                <legend className="sr-only">ネタの材料</legend>
                <div className="flex flex-col gap-2">
                  {sources.map((k) => {
                    const s = SOURCE_INFO[k];
                    const on = source === k;
                    const off = k === "commits" && !repoFullName ? "GitHub をつなぐと使えます" : k === "notes" && notes.length === 0 ? "使っていないメモがありません" : null;
                    return (
                      <div key={k} className={`flex items-center gap-3 rounded-md border px-4 py-3 ${on ? "border-primary" : "border-border hover:border-input"}`}>
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input type="radio" name="idea-source" value={k} checked={on} onChange={() => setSource(k)} className="size-4 shrink-0 accent-[var(--primary)]" />
                          <span className="flex min-w-0 flex-col">
                            <span className={`text-[15px] ${on ? "font-bold" : ""}`}>{s.title}</span>
                            <span className="truncate text-[13px] text-faint">{off ?? s.summary}</span>
                          </span>
                        </label>
                        <HelpTip label={s.title} align="right">
                          <p>{s.summary}</p>
                          <p className="mt-1">よいところ: {s.good}</p>
                          <p className="mt-1">気をつけること: {s.note}</p>
                        </HelpTip>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => go(2)} className="max-sm:w-full">
                  次へ: 中身を入れる
                </Button>
              </div>
            </section>
          )}

          {shown === 2 && (
            <section className={card} aria-labelledby="ideas-step-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 id="ideas-step-2" ref={headingRef} tabIndex={-1} className={heading}>
                  {STEP2_TITLE[source]}
                </h2>
                <button type="button" onClick={() => go(1)} className="text-[13px] text-muted underline hover:text-fg">
                  材料を変える
                </button>
              </div>

              {source === "commits" &&
                (repoFullName ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-[15px] font-bold">読むコミットの期間</legend>
                    <div className="flex flex-wrap gap-2">
                      {IDEA_PERIODS.map((p) => (
                        <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)} className={pill(days === p)}>
                          {PERIOD_LABEL[p]}
                        </button>
                      ))}
                    </div>
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-faint">
                      <span className="break-all">{repoFullName}</span>
                      <Link href={`/projects/${projectId}/github`} className="underline">
                        変える
                      </Link>
                      <HelpTip label="読むもの">.env や鍵などのファイルは読まず、コミットの中身は yabumi に残しません。</HelpTip>
                    </p>
                  </fieldset>
                ) : (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface2 px-4 py-3 text-[15px]">
                    <span className="flex items-center gap-1.5">
                      GitHub をつなぐと使えます
                      <HelpTip label="GitHub">リポジトリを読むだけで、書き込みはしません。非公開のリポジトリも読めます。</HelpTip>
                    </span>
                    {githubReady ? (
                      <ButtonLink href={`/projects/${projectId}/github`} variant="secondary" size="sm">
                        GitHub をつなぐ
                      </ButtonLink>
                    ) : (
                      <NotReadyButton variant="secondary" size="sm">
                        GitHub をつなぐ
                      </NotReadyButton>
                    )}
                  </div>
                ))}

              {source === "news" && (
                <fieldset className="flex flex-col gap-4">
                  <legend className="mb-2 flex items-center gap-1.5 text-[15px] font-bold">
                    最近のできごと<span className="text-[13px] font-normal text-faint">どれか 1 つで出せます</span>
                  </legend>
                  {newsQuestions.map((q, i) => (
                    <div key={q.question} className="flex flex-col gap-2">
                      <label htmlFor={`idea-news-${i}`} className="text-[15px] leading-[1.7]">
                        {q.question}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {q.choices.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setNews((cur) => cur.map((x, j) => (j === i ? (x.trim() ? `${x}${x.endsWith("。") ? "" : "。"}${c}` : c) : x)))}
                            className={pill(false)}
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
                        placeholder={newsExample}
                      />
                    </div>
                  ))}
                </fieldset>
              )}

              {source === "notes" &&
                (notes.length ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 flex items-center gap-1.5 text-[15px] font-bold">
                      使うメモ<span className="num text-[13px] font-normal text-faint">{MAX_NOTES_FOR_IDEAS} 件まで</span>
                      <HelpTip label="メモ">
                        関係するメモはまとめて 1 つのネタになります。AI に送るのはメモの文だけで、写真は下書きに添えます。
                      </HelpTip>
                    </legend>
                    <ul className="flex max-h-[22rem] flex-col gap-2 overflow-y-auto">
                      {notes.map((n) => {
                        const on = noteIds.includes(n.id);
                        const empty = !n.body.trim();
                        return (
                          <li key={n.id}>
                            <label
                              className={`flex gap-3 rounded-md border px-3.5 py-2.5 text-[15px] leading-[1.7] ${empty ? "border-line opacity-55" : on ? "cursor-pointer border-primary" : "cursor-pointer border-border hover:border-input"}`}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={empty || (!on && noteIds.length >= MAX_NOTES_FOR_IDEAS)}
                                onChange={() => toggleNote(n.id)}
                                className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                              />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="line-clamp-3 break-words whitespace-pre-wrap">{empty ? "（画像だけのメモ。ネタ帳でひとこと書き足すと使えます）" : n.body}</span>
                                <span className="num text-[13px] text-faint">
                                  {formatShort(n.createdAt)}
                                  {n.hasImage && "・写真あり"}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <Link href={`/projects/${projectId}/notes`} className="w-fit text-[13px] text-muted underline hover:text-fg">
                      ネタ帳を開く
                    </Link>
                  </fieldset>
                ) : (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface2 px-4 py-3 text-[15px]">
                    <span className="flex items-center gap-1.5">
                      使っていないメモがありません
                    </span>
                    <ButtonLink href={`/projects/${projectId}/notes`} variant="secondary" size="sm">
                      ネタ帳を開く
                    </ButtonLink>
                  </div>
                ))}

              {source === "plan" && (
                <p className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface2 px-4 py-3 text-[15px]">
                  入力はいりません
                  <Link href={`/projects/${projectId}/plan`} className="ml-auto text-[13px] text-muted underline hover:text-fg">
                    アカウント設計を見る
                  </Link>
                </p>
              )}

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 flex items-center gap-1.5 text-[15px] font-bold">
                  下書きを書く SNS<span className="num text-[13px] font-normal text-faint">{maxSns} つまで</span>
                  <HelpTip label="SNS">SNS ごとに長さと書き方を変えます。</HelpTip>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {snsOptions.map((k) => (
                    <label key={k} className={`cursor-pointer ${pill(sns.includes(k))}`}>
                      <input type="checkbox" className="sr-only" checked={sns.includes(k)} onChange={() => toggleSns(k)} />
                      {sns.includes(k) && <span aria-hidden>✓</span>}
                      {SNS[k].label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {noPillars && (
                <p className="flex items-center gap-1.5 text-[13px] text-faint">
                  投稿の柱がまだ決まっていません
                  <HelpTip label="投稿の柱">
                    アカウント設計で決めると、ネタが柱に沿います（決めなくても出せます）。
                  </HelpTip>
                  <Link href={`/projects/${projectId}/plan`} className="text-muted underline hover:text-fg">
                    アカウント設計
                  </Link>
                </p>
              )}

              <div className="flex flex-col gap-2">
                {aiEnabled ? (
                  <Button size="lg" disabled={pending || !canGenerate} onClick={() => run("generate", () => generateIdeas(projectId, input, sns))} className="w-full">
                    {info.button}
                  </Button>
                ) : (
                  <NotReadyButton size="lg">{info.button}</NotReadyButton>
                )}
                {working === "generate" ? (
                  <span role="status" className="text-[13px] text-muted">
                    {info.working}
                  </span>
                ) : (
                  <span className="text-[13px] text-faint">{info.cost}（月の上限の中で数えます）</span>
                )}
              </div>
            </section>
          )}

          {shown === 3 && thread && latest && (
            <section className="flex flex-col gap-4" aria-labelledby="ideas-step-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id="ideas-step-3" ref={headingRef} tabIndex={-1} className={heading}>
                  ネタの案
                </h2>
                <span className="text-[15px] text-faint">
                  {sourceLabel(thread)}
                  {thread.answered && "・答えを反映"}
                </span>
              </div>
              <ol className="flex flex-col gap-4">
                {latest.ideas.map((idea, i) => (
                  <IdeaCard
                    key={`${thread.latest.messageId}-${i}`}
                    idea={idea}
                    repoFullName={thread.request.repo || repoFullName || ""}
                    notes={(idea.notes ?? []).map((n) => thread.request.notes?.[n - 1]).filter((n): n is NonNullable<typeof n> => Boolean(n))}
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
        {side}
      </div>
    </div>
  );
}

// 結果の見出しに添える、何から出したか
function sourceLabel(thread: IdeasThread): string {
  const r = thread.request;
  if (r.source === "news") return "最近のできごとから";
  if (r.source === "plan") return "アカウント設計から";
  if (r.source === "notes") return `ネタ帳のメモ ${r.notes?.length ?? 0} 件から`;
  const days = r.days ?? 0;
  return `直近 ${PERIOD_LABEL[days as IdeaPeriod] ?? `${days} 日`}のコミット ${r.commitCount ?? 0} 件から`;
}

function IdeaCard({
  idea,
  repoFullName,
  notes,
  adoptedPostId,
  projectId,
  disabled,
  saving,
  onAdopt,
}: {
  idea: PostIdea;
  repoFullName: string;
  notes: IdeaNoteMaterial[];
  adoptedPostId: string | null;
  projectId: string;
  disabled: boolean;
  saving: boolean;
  onAdopt: () => void;
}) {
  return (
    <li className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
      <div className="flex flex-col gap-1.5">
        {idea.pillar && (
          <Badge className="w-fit">柱: {idea.pillar}</Badge>
        )}
        <h3 className="text-[17px] font-bold">{idea.title}</h3>
        {idea.angle && <p className="text-[15px] leading-[1.7] text-muted">{idea.angle}</p>}
      </div>

      {idea.drafts.some((d) => needsFillIn(d.text)) && (
        <p className="flex items-center gap-1.5 text-[13px]">
          <span className="font-bold text-signal">● 【】を書き換える</span>
          <HelpTip label="書き換え">【】で囲んだところは、あなたにしか書けない部分です。下書きにしたあと、自分の言葉に書き換えてから送ってください。</HelpTip>
        </p>
      )}

      <div className="flex flex-col gap-3">
        {idea.drafts.map((d) => {
          const check = checkTarget(d.sns, d.text);
          const tooLong = check.issues.includes("too_long");
          return (
            <div key={d.sns} className="flex flex-col gap-1.5 rounded-md border border-line bg-surface2 px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <SnsMark sns={d.sns} />
                <span className={`num ${tooLong ? "font-bold text-danger" : "text-faint"}`}>
                  {check.length.toLocaleString("ja-JP")}
                  {check.maxLength !== null && ` / ${check.maxLength.toLocaleString("ja-JP")}`}
                  {tooLong && `（${(check.length - check.maxLength!).toLocaleString("ja-JP")} 字多い。投稿の画面で縮める）`}
                </span>
              </div>
              <p className="text-[15px] leading-[1.75] whitespace-pre-wrap">{d.text}</p>
            </div>
          );
        })}
      </div>

      {notes.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-[13px] text-muted">
            元にしたメモ（{notes.length} 件{notes.some((n) => n.photo) && "。写真は下書きに添えます"}）
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 leading-[1.7]">
            {notes.map((n) => (
              <li key={n.id} className="break-words whitespace-pre-wrap">
                {n.body}
                {n.photo && <span className="ml-1 text-xs text-muted">（写真あり）</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {idea.commits.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-[13px] text-muted">元にしたコミット（{idea.commits.length} 件）</summary>
          <ul className="mt-2 flex flex-col gap-1.5 leading-[1.7]">
            {idea.commits.map((c) => (
              <li key={c.sha}>
                {c.note}{" "}
                <a href={`https://github.com/${repoFullName}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs underline">
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
            <Link href={`/projects/${projectId}/posts/${adoptedPostId}`} className="text-sm font-semibold underline">
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
