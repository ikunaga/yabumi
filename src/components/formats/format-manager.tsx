"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { AiThinking } from "@/components/ui/ai-thinking";
import { Button, NotReadyButton } from "@/components/ui/button";
import { draftPostFormats } from "@/lib/ai/post-format-actions";
import type { FormatProposal } from "@/lib/ai/post-format-ai";
import { Input, Textarea } from "@/components/ui/field";
import {
  addPostFormat,
  deleteFormatRound,
  deletePostFormat,
  listFormatRounds,
  pasteFormatRounds,
  updatePostFormat,
  type FormatsResult,
} from "@/lib/post-formats/actions";
import { EMPTY_SERIES, MAX_FORMAT_VARS, MAX_PASTE_ROUNDS, MAX_ROUNDS, cleanSeries, isSeries, pasteVar, roundTitle, seriesProblem, type FormatRound, type FormatSeries } from "@/lib/post-formats/series";
import { VarChips, VariablesFields, insertAt } from "./variables-fields";
import {
  MAX_FORMAT_BODY,
  MAX_FORMAT_EXAMPLE,
  MAX_FORMAT_KIND,
  MAX_FORMAT_MUST,
  MAX_FORMAT_REFINE,
  POST_FORMAT_DAILY_RUNS,
  MAX_FORMAT_NAME,
  MAX_FORMAT_PURPOSE,
  MAX_FORMAT_SLOTS,
  MAX_POST_FORMATS,
  FORMAT_HASHTAG_KEYS,
  formatInputSchema,
  hashtagKeyLabel,
  type FormatHashtagKey,
  type FormatHashtags,
  type PostFormat,
  type PostFormatInput,
} from "@/lib/post-formats/schema";
import type { SnsKey } from "@/lib/sns";
import { MAX_TARGET_HASHTAGS, hashtagLine, normalizeHashtag, parseHashtagInput } from "@/lib/sns/hashtags";
import { FormatImageFields } from "@/components/posts/format-image-fields";
import { Choice } from "@/components/posts/maker-parts";
import { ErrorBanner } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { EMPTY_IMAGE, cleanFormatImage } from "@/lib/post-formats/image";
import { DisclosureBox } from "@/components/ui/disclosure";
import { AiQuotaNote } from "@/components/ai/ai-quota-note";
import { useAiQuota } from "@/components/ai/use-ai-quota";
import { FORMAT_AI_BLOCKED_WORDS } from "@/lib/ai/budget-status-text";

// フォーマットの画面（/projects/[id]/formats。2026-11-18 オーナーの了承で、投稿をつくるの中の畳んだ「フォーマットを管理」から移した）。
// 2026-11-21 オーナーの指摘「どこが一覧なのか分かりづらすぎる」で、一覧・編集・新しく作るの 3 つの画面に分けた（?edit=id・?new=…）:
// - 一覧: 見出しに件数と「＋ 新しいフォーマット」。1 件ずつカード（名前・シリーズの札・本文の 1 行目・小さな要約）。押すと編集の画面
// - 編集: 編集の欄・これまでの投稿（シリーズ）・削除（確認つき）
// - 新しく作る: 「白紙から」「例から選ぶ」「AI とつくる」を選ぶ
// 一覧の正はサーバー（操作のたびに返った一覧に入れ替える）。シリーズにして保存したとき（AI が考える変数が 0 → 1 以上）は、
// 編集の画面で「これまでの投稿を貼る」を開いて出す（docs/design/format-series.md の 2）
export type FormatsView = { kind: "list" } | { kind: "edit"; id: string } | { kind: "new"; how: "choose" | "blank" | "example" | "ai" };

export function FormatManager({
  projectId,
  formats,
  examples,
  kinds,
  roundCounts,
  pillars,
  planHashtags,
  connected,
  aiEnabled,
  view,
  go,
  back,
  onChange,
}: {
  projectId: string;
  formats: PostFormat[];
  examples: PostFormatInput[];
  kinds: string[];
  roundCounts: Record<string, number>;
  pillars: string[];
  planHashtags: string[];
  connected: SnsKey[];
  aiEnabled: boolean;
  view: FormatsView;
  go: (v: FormatsView) => void;
  back: { href: string; label: string } | null;
  onChange: (r: FormatsResult) => void;
}) {
  const [pending, start] = useTransition();
  // AI の案から始めるときの中身
  const [draft, setDraft] = useState<PostFormatInput | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // シリーズにしたばかりのフォーマット（これまでの投稿を貼る案内を出す）と、保存したばかりのフォーマット（「保存しました」を出す）
  const [justSeries, setJustSeries] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const run = (fn: () => Promise<FormatsResult>, after?: (r: FormatsResult) => void) =>
    start(async () => {
      const r = await fn();
      onChange(r);
      if (!r.error) after?.(r);
    });
  // 保存のあと、そのフォーマットの編集の画面にする（新しく作ったものは、前の一覧になかった id）。シリーズになったら案内を出す
  const afterSave = (r: FormatsResult, before: PostFormat | undefined) => {
    const after = r.formats?.find((f) => (before ? f.id === before.id : !formats.some((o) => o.id === f.id)));
    if (!after) return go({ kind: "list" });
    setSaved(after.id);
    if (isSeries(after.series) && !(before && isSeries(before.series))) setJustSeries(after.id);
    if (!before) go({ kind: "edit", id: after.id });
  };
  const left = MAX_POST_FORMATS - formats.length;
  const addable = examples.filter((e) => !formats.some((f) => f.name === e.name));
  const backLink = (label: string, to: FormatsView) => (
    <button type="button" onClick={() => (setConfirmDelete(false), go(to))} className="self-start text-sm text-muted underline hover:text-fg">
      ← {label}
    </button>
  );

  // ===== 編集の画面 =====
  if (view.kind === "edit") {
    const f = formats.find((x) => x.id === view.id);
    if (!f) {
      return (
        <div className="flex flex-col gap-3">
          {backLink("フォーマットの一覧", { kind: "list" })}
          <p className="text-sm text-muted">このフォーマットは見つかりませんでした。削除されたかもしれません。</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        {backLink("フォーマットの一覧", { kind: "list" })}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[24px] leading-tight font-bold">{f.name}</h1>
          {isSeries(f.series) && <SeriesTag />}
        </div>
        {saved === f.id && (
          <p role="status" className="text-sm font-semibold text-success">
            保存しました。
          </p>
        )}
        <section className="rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
          <FormatEditor
            key={f.id}
            projectId={projectId}
            initial={f}
            pillars={pillars}
            planHashtags={planHashtags}
            connected={connected}
            pending={pending}
            onCancel={() => go({ kind: "list" })}
            onSave={(v) => (setSaved(null), run(() => updatePostFormat(projectId, f.id, v), (r) => afterSave(r, f)))}
          />
        </section>
        {isSeries(f.series) && (
          <section className="flex flex-col gap-2">
            {justSeries === f.id && <p className="rounded-md bg-subtle px-3 py-2 text-[13px] font-bold">これまでに出した投稿はありますか？　貼ると、次の投稿の案と重なりません</p>}
            <SeriesRounds key={justSeries === f.id ? "open" : "closed"} projectId={projectId} format={f} open={justSeries === f.id} />
          </section>
        )}
        <section className="flex flex-col gap-2 border-t border-line pt-4">
          {confirmDelete ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm leading-[1.7]">「{f.name}」を削除します。これまでの投稿の記録も削除し、元に戻せません。SNS に出した投稿は消えません。</p>
              <span className="flex flex-wrap gap-2">
                <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => deletePostFormat(projectId, f.id), () => (setConfirmDelete(false), go({ kind: "list" })))}>
                  {pending ? "削除しています…" : "このフォーマットを削除する"}
                </Button>
                <Button size="sm" variant="text" onClick={() => setConfirmDelete(false)}>
                  やめる
                </Button>
              </span>
            </div>
          ) : (
            <Button size="sm" variant="secondary" className="self-start" onClick={() => setConfirmDelete(true)}>
              このフォーマットを削除する
            </Button>
          )}
        </section>
      </div>
    );
  }

  // ===== 新しく作る画面 =====
  if (view.kind === "new") {
    if (left <= 0) {
      return (
        <div className="flex flex-col gap-3">
          {backLink("フォーマットの一覧", { kind: "list" })}
          <p className="text-sm text-muted">フォーマットは {MAX_POST_FORMATS} 個までです。使っていないものを削除すると、新しく作れます。</p>
        </div>
      );
    }
    const choose = { kind: "new", how: "choose" } as const;
    return (
      <div className="flex flex-col gap-4">
        {backLink(view.how === "choose" ? "フォーマットの一覧" : "作り方を選び直す", view.how === "choose" ? { kind: "list" } : choose)}
        <h1 className="text-[24px] leading-tight font-bold">新しいフォーマット</h1>
        {view.how === "choose" && (
          <ul className="flex flex-col gap-3">
            <NewWay title="白紙から" note="名前と本文を自分で書きます" onClick={() => (setDraft(null), go({ kind: "new", how: "blank" }))} />
            {addable.length > 0 && <NewWay title="例から選ぶ" note="よく使う形から選んで、編集します" onClick={() => go({ kind: "new", how: "example" })} />}
            {aiEnabled ? (
              <NewWay title="AI とつくる" note="何の投稿かを選ぶと、AI が案を出します" onClick={() => go({ kind: "new", how: "ai" })} />
            ) : (
              <li>
                <NotReadyButton variant="secondary">AI とつくる</NotReadyButton>
              </li>
            )}
          </ul>
        )}
        {view.how === "example" && (
          <ul className="flex flex-col gap-3">
            {addable.map((e) => (
              <li key={e.name}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => addPostFormat(projectId, e), (r) => afterSave(r, undefined))}
                  className="flex w-full flex-col gap-1 rounded-lg border border-border bg-surface px-5 py-4 text-left hover:border-primary disabled:opacity-60"
                >
                  <span className="font-bold">{e.name}</span>
                  <span className="line-clamp-2 text-sm leading-[1.7] whitespace-pre-line text-muted">{e.body}</span>
                  <span className="text-sm font-bold text-primary">{pending ? "追加しています…" : "これを追加して編集する →"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {view.how === "ai" && (
          <section className="rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
            <FormatAiMaker projectId={projectId} kinds={[...pillars, ...kinds.filter((k) => !pillars.includes(k))]} onPick={(p) => (setDraft(p), go({ kind: "new", how: "blank" }))} onCancel={() => go(choose)} />
          </section>
        )}
        {view.how === "blank" && (
          <section className="rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
            <FormatEditor
              key={draft?.name ?? "new"}
              projectId={projectId}
              initial={draft ?? undefined}
              pillars={pillars}
              planHashtags={planHashtags}
              connected={connected}
              pending={pending}
              onCancel={() => (setDraft(null), go({ kind: "list" }))}
              onSave={(v) => run(() => addPostFormat(projectId, v), (r) => (setDraft(null), afterSave(r, undefined)))}
            />
          </section>
        )}
      </div>
    );
  }

  // ===== 一覧 =====
  const add = (
    <Button disabled={left <= 0} onClick={() => go({ kind: "new", how: "choose" })} className="max-sm:w-full">
      ＋ 新しいフォーマット
    </Button>
  );
  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title="フォーマット"
        sub={`毎回くり返し使う投稿のひな形です。いまは ${formats.length} 個です。`}
        help={
          <>
            毎回くり返し使う投稿のひな形です。「投稿をつくる」の「フォーマットから書く」で選べます。本文に {"{商品}"} のように書いたところが変数になり、投稿ごとに言葉が入れ替わります。変数は {MAX_FORMAT_VARS} 個までです。本文に書けるのは {MAX_FORMAT_SLOTS} 種類までです。フォーマットは {MAX_POST_FORMATS} 個までつくれます。
          </>
        }
        actions={
          <>
            {back && (
              <Link href={back.href} className="text-sm underline">
                ← {back.label}
              </Link>
            )}
            {add}
          </>
        }
      />
      {formats.length === 0 ? (
        <p className="rounded-lg border border-dashed border-input px-6 py-8 text-center text-sm leading-[1.8] text-muted">
          まだフォーマットはありません。
          <br />
          新メニューのお知らせなど、よく出す投稿の形を残せます。
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="フォーマットの一覧">
          {formats.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => (setSaved(null), setJustSeries(null), setConfirmDelete(false), go({ kind: "edit", id: f.id }))}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-5 py-4 text-left hover:border-primary max-sm:px-4"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{f.name}</span>
                    {isSeries(f.series) && <SeriesTag />}
                  </span>
                  <span className="truncate text-sm text-muted">本文: {f.body.split("\n").find((l) => l.trim()) ?? ""}</span>
                  {cardSummary(f, roundCounts[f.id] ?? 0).length > 0 && (
                    <span className="flex flex-wrap gap-x-1 text-xs text-faint">
                      {cardSummary(f, roundCounts[f.id] ?? 0).map((p, i) => (
                        <span key={p} className="whitespace-nowrap">
                          {i > 0 && "・"}
                          {p}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span aria-hidden className="shrink-0 text-muted">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {left <= 0 && <p className="text-xs text-muted">フォーマットは {MAX_POST_FORMATS} 個までです。使っていないものを削除すると、新しく作れます。</p>}
    </div>
  );
}

// カードの小さな要約（「画像も AI でつくる・ハッシュタグ 4 個・これまでの投稿 4 本」。ja-copy-reviewer: 何の数かを書く）。ないものは書かない
function cardSummary(f: PostFormat, rounds: number): string[] {
  const tags = new Set(Object.values(f.hashtags).flatMap((x) => x ?? [])).size;
  const parts: string[] = [f.image ? "画像も AI でつくる" : null, tags ? `ハッシュタグ ${tags} 個` : null, isSeries(f.series) ? `これまでの投稿 ${rounds} 本` : null].filter((x): x is string => Boolean(x));
  return parts;
}

function SeriesTag() {
  // シリーズの札。「シリーズ」だけでは意味が伝わらない（ja-copy-reviewer）ので、何が起きるかを書く
  return <span className="rounded-sm bg-info-soft px-1.5 py-0.5 text-xs font-bold text-info">変数を毎回 AI が考える</span>;
}

// 新しく作るときの作り方 1 つ（押すと、その作り方の画面）
function NewWay({ title, note, onClick }: { title: string; note: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-5 py-4 text-left hover:border-primary max-sm:px-4">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-bold">{title}</span>
          <span className="text-sm text-muted">{note}</span>
        </span>
        <span aria-hidden className="shrink-0 text-muted">
          ›
        </span>
      </button>
    </li>
  );
}

export function FormatEditor({
  projectId,
  initial,
  pillars,
  planHashtags,
  connected,
  pending,
  onSave,
  onCancel,
}: {
  projectId: string;
  initial?: PostFormatInput;
  pillars: string[];
  planHashtags: string[];
  connected: SnsKey[];
  pending: boolean;
  onSave: (v: PostFormatInput) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<PostFormatInput>(initial ?? { name: "", purpose: "", body: "", example: "", pillar: "", hashtags: {} });
  // 毎回付けるタグの欄（書いたままの文字。保存するときにタグの配列にする）
  const [tags, setTags] = useState<Partial<Record<FormatHashtagKey, string>>>(() =>
    Object.fromEntries(FORMAT_HASHTAG_KEYS.filter((k) => initial?.hashtags?.[k]?.length).map((k) => [k, hashtagLine(initial!.hashtags[k]!)])),
  );
  // 変数（docs/design/format-series.md の 1）。本文・画像の設定に {名前} と書いた分は、一覧になければ「自分で入れる」変数として足して見せる
  const [rawSeries, setSeries] = useState<FormatSeries>(initial?.series ?? EMPTY_SERIES);
  // 画像（docs/design/format-image.md の 1.）。絵の説明が空なら画像なしで保存する
  const [image, setImage] = useState(initial?.image ?? EMPTY_IMAGE);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (k: Exclude<keyof PostFormatInput, "hashtags" | "series">, x: string) => (setV((o) => ({ ...o, [k]: x })), setProblem(null));
  const setTag = (k: FormatHashtagKey, x: string) => (setTags((o) => ({ ...o, [k]: x })), setProblem(null));
  const series = cleanSeries(rawSeries, { body: v.body, image: image.prompt.trim() ? image : null });
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  function insertIntoBody(token: string) {
    const { next, caret } = insertAt(bodyRef.current, v.body, token);
    set("body", [...next].slice(0, MAX_FORMAT_BODY).join(""));
    requestAnimationFrame(() => {
      bodyRef.current?.focus();
      bodyRef.current?.setSelectionRange(caret, caret);
    });
  }

  // スマホは 名前〜本文 → 変数 → ほかの欄の順。PC は左に名前〜本文とほかの欄、右に変数（2026-11-21 オーナーが了承した案）
  return (
    // 列は grid-cols-1（minmax(0,1fr)）。列を決めないと auto になり、長い 1 行（AI への指示など）で列が画面より広がり、スマホで右にはみ出す（2026-11-24 オーナーが「こわれてる」）
    <div className="grid grid-cols-1 gap-x-5 gap-y-2.5 [grid-template-areas:'top'_'vars'_'rest'] lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'top_vars'_'rest_vars']">
      <div className="flex flex-col gap-2.5 [grid-area:top]">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold">名前</span>
        <Input value={v.name} maxLength={MAX_FORMAT_NAME} onChange={(e) => set("name", e.target.value)} placeholder="例: 新メニューのお知らせ" className="py-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold">
          いつ使う<span className="ml-1.5 font-normal text-muted">任意</span>
        </span>
        <Input value={v.purpose} maxLength={MAX_FORMAT_PURPOSE} onChange={(e) => set("purpose", e.target.value)} placeholder="例: 新しいメニューや季節の商品を出すとき" className="py-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold">本文</span>
        <Textarea
          ref={bodyRef}
          value={v.body}
          maxLength={MAX_FORMAT_BODY}
          rows={4}
          onChange={(e) => set("body", e.target.value)}
          placeholder={"例: 【新メニュー】{何が}\n{いつから}から、{いくら}でお出しします。"}
          // スマホの幅では本文の行が増えて、4 行の高さだと下が切れる。中身に合わせて伸ばす（2026-11-24）
          className="min-h-[7.5rem] py-2 text-sm [field-sizing:content]"
        />
        {series.vars.length === 0 && <span className="text-xs text-muted">本文に {"{商品}"} のように書くと、そこが投稿ごとに変わる変数になります</span>}
      </label>
      <VarChips series={series} onInsert={insertIntoBody} />
      </div>
      {/* 変数は本文のすぐ下（PC は右の列）に出す（前はいちばん下に畳まれていて見つからなかった。パワポの 1・3・8） */}
      <div className="self-start [grid-area:vars]">
        <VariablesFields series={series} texts={{ body: v.body, image: image.prompt.trim() ? image : null }} setSeries={(x) => (setSeries(x), setProblem(null))} />
      </div>
      <div className="flex flex-col gap-2.5 [grid-area:rest]">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold">
          できあがる投稿の例<span className="ml-1.5 font-normal text-muted">任意</span>
        </span>
        <Textarea value={v.example} maxLength={MAX_FORMAT_EXAMPLE} rows={3} onChange={(e) => set("example", e.target.value)} placeholder="変数に言葉を入れた、できあがりの投稿の例。投稿をつくるときに、手本として出します" className="py-2 text-sm" />
      </label>
      {pillars.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold">
            投稿のテーマ<span className="ml-1.5 font-normal text-muted">任意</span>
          </span>
          <select value={pillars.includes(v.pillar) ? v.pillar : ""} onChange={(e) => set("pillar", e.target.value)} className="rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm max-sm:text-[16px]">
            <option value="">テーマなし</option>
            {pillars.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
      <FormatTagsFields tags={tags} setTag={setTag} planHashtags={planHashtags} connected={connected} />
      <FormatImageFields projectId={projectId} body={v.body} series={series} image={image} setImage={(x) => (setImage(x), setProblem(null))} />
      {problem && <p className="text-sm font-semibold text-danger">{problem}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || !v.name.trim() || !v.body.trim()}
          onClick={() => {
            const p = formatInputSchema.safeParse({ ...v, pillar: pillars.includes(v.pillar) ? v.pillar : "", hashtags: tags, series });
            if (!p.success) return setProblem(p.error.issues[0]?.message ?? "保存できませんでした。入れた内容を見直してください。");
            const sp = seriesProblem(series);
            if (sp) return setProblem(sp);
            // 画像の変数の決まりも画面で先に確かめる（正はサーバー）
            const img = cleanFormatImage(image, series);
            if (img.problem) return setProblem(img.problem);
            onSave({ ...p.data, image: img.image });
          }}
        >
          {pending ? "保存しています…" : "保存する"}
        </Button>
        <Button size="sm" variant="text" onClick={onCancel}>
          やめる
        </Button>
      </div>
      </div>
    </div>
  );
}

// フォーマットのタグを 1 行で（全部の SNS のタグと、SNS だけのタグ）
export function FormatTagsLine({ h, className }: { h: FormatHashtags; className?: string }) {
  const parts = FORMAT_HASHTAG_KEYS.filter((k) => h[k]?.length).map((k) => `${k === "all" ? "" : `${hashtagKeyLabel(k)}: `}${hashtagLine(h[k]!)}`);
  return <p className={`break-words ${className ?? ""}`}>タグ {parts.join(" ／ ")}</p>;
}

// 毎回付けるタグの欄（docs/architecture.md の 4.59）。全部の SNS に付けるタグと、畳んだ「SNS ごとに変える」。
// アカウント設計のハッシュタグの候補は、押すと全部の SNS の欄に足す
// プロジェクトの設定の「いつものタグ」も同じ欄を使う（legend・footnote を変える。2026-11-17）
export function FormatTagsFields({
  tags,
  setTag,
  planHashtags,
  connected,
  legend = "毎回付けるタグ",
  footnote = "本文の下に 1 行あけて付きます。投稿ごとに編集できます。",
}: {
  tags: Partial<Record<FormatHashtagKey, string>>;
  setTag: (k: FormatHashtagKey, x: string) => void;
  planHashtags: string[];
  connected: SnsKey[];
  legend?: string;
  footnote?: string;
}) {
  const allTags = parseHashtagInput(tags.all ?? "").tags.map((t) => t.toLowerCase());
  const candidates = planHashtags.map(normalizeHashtag).filter((t) => t && !allTags.includes(t.toLowerCase()));
  // つないだ SNS を先に出し、つないでいない SNS は「そのほかの SNS」に畳む（PMO の確かめ。フォーマットはプロジェクトのものなので、あとでつなぐ SNS の分も持てる）。
  // つないだ SNS がなければ、すべて出す
  const perSns = FORMAT_HASHTAG_KEYS.filter((k): k is SnsKey => k !== "all");
  const shown = connected.length ? perSns.filter((k) => connected.includes(k)) : perSns;
  const rest = perSns.filter((k) => !shown.includes(k));
  const field = (k: SnsKey) => (
    <label key={k} className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-bold">{hashtagKeyLabel(k)}</span>
      <Input value={tags[k] ?? ""} maxLength={400} onChange={(e) => setTag(k, e.target.value)} placeholder="空なら全部の SNS と同じ" className="py-2 text-sm" />
    </label>
  );
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-xs font-bold">
        {legend}
        <span className="ml-1.5 font-normal text-muted">任意</span>
      </legend>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">全部の SNS に付けるハッシュタグ。{MAX_TARGET_HASHTAGS} 個まで</span>
        <Input value={tags.all ?? ""} maxLength={400} onChange={(e) => setTag("all", e.target.value)} placeholder="例: #パン屋 #焼きたて" className="py-2 text-sm" />
      </label>
      {candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">アカウントの方針で決めたタグ:</span>
          {candidates.map((t) => (
            <Button key={t} type="button" size="sm" variant="text" onClick={() => setTag("all", `${(tags.all ?? "").trim()} #${t}`.trim())}>
              ＋ #{t}
            </Button>
          ))}
        </div>
      )}
      <DisclosureBox label="SNS ごとのハッシュタグを表示" className="text-xs" open={perSns.some((k) => (tags[k] ?? "").trim() !== "")}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 max-sm:grid-cols-1">{shown.map(field)}</div>
        {rest.length > 0 && (
          <DisclosureBox label="つないでいない SNS を表示" count={rest.length} className="mt-2" open={rest.some((k) => (tags[k] ?? "").trim() !== "")}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 max-sm:grid-cols-1">{rest.map(field)}</div>
          </DisclosureBox>
        )}
      </DisclosureBox>
      <span className="text-xs text-muted">{footnote}</span>
    </fieldset>
  );
}

// AI とつくる（docs/design/post-formats.md の 3）: 何の投稿か → 決まって入れたいこと → 案 3 つ（理由つき）→ 選ぶと欄に入って直してから保存する。案は保存しない
function FormatAiMaker({ projectId, kinds, onPick, onCancel }: { projectId: string; kinds: string[]; onPick: (p: PostFormatInput) => void; onCancel: () => void }) {
  // AI を使える量を使い切っているときは押せない（理由はボタンの下に 1 行）
  const quota = useAiQuota("post_format", true, FORMAT_AI_BLOCKED_WORDS);
  const [kind, setKind] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const [must, setMust] = useState("");
  const [refine, setRefine] = useState("");
  const [proposals, setProposals] = useState<FormatProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = kind === "" ? other.trim() : (kind ?? "");

  const ask = (withRefine: boolean) =>
    start(async () => {
      setError(null);
      const r = await draftPostFormats(projectId, { kind: chosen, must, refine: withRefine ? refine : "" });
      if (r.error || !r.proposals) setError(r.error ?? "案を出せませんでした。少し待ってから、もう一度押してください。");
      else setProposals(r.proposals);
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold">何の投稿のひな形をつくりますか</span>
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <Choice key={k} on={kind === k} onClick={() => setKind(k)}>
              {k}
            </Choice>
          ))}
          <Choice on={kind === ""} onClick={() => setKind("")}>
            そのほか
          </Choice>
        </div>
        {kind === "" && <Input aria-label="何の投稿か" value={other} maxLength={MAX_FORMAT_KIND} onChange={(e) => setOther(e.target.value)} placeholder="例: 週末のイベントのお知らせ" className="py-2 text-sm" />}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold">
          毎回かならず入れたいこと<span className="ml-1.5 font-normal text-muted">任意</span>
        </span>
        <Input value={must} maxLength={MAX_FORMAT_MUST} onChange={(e) => setMust(e.target.value)} placeholder="例: 最後に予約の案内を入れたい" className="py-2 text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" disabled={pending || !chosen || quota.blocked !== null} onClick={() => ask(false)}>
          {pending ? "考えています…" : proposals ? "案を出し直す" : "AI に案を出してもらう"}
        </Button>
        <span className="basis-full">
          <AiQuotaNote blocked={quota.blocked} />
        </span>
        <span className="text-xs text-muted">案を出すたびに 5〜10 円ほどかかります。1 日 {POST_FORMAT_DAILY_RUNS} 回までです。</span>
        <Button size="sm" variant="text" onClick={onCancel}>
          やめる
        </Button>
      </div>
      {pending && <AiThinking kind="brief" note="10〜20 秒ほどかかります" />}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {proposals && !pending && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold">案</span>
          <span className="text-xs text-muted">選ぶと下の欄に入ります。編集してから保存してください。</span>
          <ul className="flex flex-col gap-2">
            {proposals.map((p) => (
              <li key={p.name} className="flex flex-col gap-1.5 rounded-md border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-bold">{p.name}</span>
                  <Button size="sm" variant="secondary" className="ml-auto" onClick={() => onPick({ name: p.name, purpose: p.purpose, body: p.body, example: p.example, pillar: p.pillar, hashtags: {} })}>
                    これを使う
                  </Button>
                </div>
                {p.purpose && <p className="text-xs text-muted">{p.purpose}</p>}
                <p className="rounded-md bg-surface2 px-3 py-2 text-[13px] leading-[1.7] whitespace-pre-wrap">{p.body}</p>
                {p.why && <p className="text-xs leading-[1.7] text-muted">{p.why}</p>}
                {p.example && (
                  <DisclosureBox label="できあがりの例を表示" className="text-xs">
                    <p className="text-[13px] leading-[1.7] whitespace-pre-wrap">{p.example}</p>
                  </DisclosureBox>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="案への希望" value={refine} maxLength={MAX_FORMAT_REFINE} onChange={(e) => setRefine(e.target.value)} placeholder="もう少しこうしたい。例: もっと短く" className="min-w-0 flex-1 py-2 text-sm max-sm:basis-full" />
            <Button size="sm" variant="secondary" disabled={pending || !refine.trim() || !chosen || quota.blocked !== null} onClick={() => ask(true)}>
              この希望で出し直す
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// フォーマットを管理の「これまでの回」（docs/design/format-series.md の 2）。開いたときに読む。消す・これまでの回を貼る
function SeriesRounds({ projectId, format, open = false }: { projectId: string; format: PostFormat; open?: boolean }) {
  const [rounds, setRounds] = useState<FormatRound[] | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => ReturnType<typeof listFormatRounds>, after?: (r: Awaited<ReturnType<typeof listFormatRounds>>) => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) return setError(r.error);
      setError(null);
      if (r.rounds) setRounds(r.rounds);
      after?.(r);
    });
  // シリーズにしたばかりのときは開いて出し、すぐ読む（toggle を待たない）
  useEffect(() => {
    if (open) run(() => listFormatRounds(projectId, format.id));
    // 開いたときの 1 回だけ（key で作り直される）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 貼った 1 行は「重ならないようにする」最初の変数（なければ最初の AI の変数）の言葉にする
  const label = pasteVar(format.series)?.name ?? "";
  return (
    <DisclosureBox
      label="このフォーマットで出した投稿を表示"
      count={rounds ? `${rounds.length} / ${MAX_ROUNDS}` : undefined}
      className="text-xs"
      open={open || undefined}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && rounds === null && !pending) run(() => listFormatRounds(projectId, format.id));
      }}
    >
      <div className="flex flex-col gap-2">
        {rounds === null && !error && <p className="text-faint">読み込んでいます…</p>}
        {rounds && rounds.length === 0 && <p className="text-muted">まだありません。「投稿をつくる」でこのフォーマットを使うと、ここに残ります。</p>}
        {rounds && rounds.length > 0 && <p className="text-muted">ここで削除しても、SNS の投稿は消えません。</p>}
        {rounds && rounds.length > 0 && (
          <ul className="flex max-h-60 flex-col divide-y divide-line overflow-y-auto rounded-md border border-line">
            {rounds.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-2.5 py-1.5">
                {/* 重ならないようにする変数の言葉を先に出し、ほかの変数の言葉を添える（PMO2 の 3 回目の n2） */}
                <span className="min-w-0 flex-1 truncate">
                  <b>{roundTitle(format.series, r.values) || Object.values(r.values)[0]}</b>
                  <span className="ml-1.5 text-muted">
                    {Object.entries(r.values)
                      .filter(([, x]) => x !== (roundTitle(format.series, r.values) || Object.values(r.values)[0]))
                      .map(([, x]) => x)
                      .join(" / ")}
                  </span>
                  <span className="ml-1.5 text-faint">{r.source === "pasted" ? "yabumi の外で出した投稿" : r.postId ? "送信済みの投稿" : "本文に入れた案"}</span>
                </span>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => deleteFormatRound(projectId, format.id, r.id))}>
                  削除
                </Button>
              </li>
            ))}
          </ul>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-bold">これまでの投稿を貼る</span>
          <span className="text-muted">
            yabumi の外で出した投稿{label ? `の${label}` : ""}を、1 行に 1 つ書きます。一度に {MAX_PASTE_ROUNDS} 行まで貼れます。次の投稿の案が、これと重ならないようにします。
          </span>
          <Textarea value={text} rows={3} onChange={(e) => (setText(e.target.value), setNote(null))} placeholder={"例:\nバック・トゥ・ザ・フューチャー\nジュラシック・パーク"} className="py-2 text-sm" />
        </label>
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          disabled={pending || !text.trim()}
          onClick={() =>
            run(
              () => pasteFormatRounds(projectId, format.id, text),
              (r) => {
                setText("");
                setNote(`${r.added ?? 0} 件を追加しました。${r.skipped ? `同じものなど ${r.skipped} 行は追加していません。` : ""}${r.overflow ? `上限のため ${r.overflow} 行は追加していません。` : ""}`);
              },
            )
          }
        >
          追加
        </Button>
        {note && <p className="font-semibold text-success">{note}</p>}
        {error && <p className="font-semibold text-danger">{error}</p>}
      </div>
    </DisclosureBox>
  );
}
