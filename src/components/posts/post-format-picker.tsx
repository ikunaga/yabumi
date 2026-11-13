"use client";

import { useEffect, useState, useTransition } from "react";
import { AiThinking } from "@/components/ui/ai-thinking";
import { Button, NotReadyButton } from "@/components/ui/button";
import { draftFormatRound, draftPostFormats } from "@/lib/ai/post-format-actions";
import type { RoundProposal } from "@/lib/ai/format-round-ai";
import type { FormatProposal } from "@/lib/ai/post-format-ai";
import { ErrorBanner } from "@/components/ui/feedback";
import { HelpTip } from "@/components/ui/help";
import { Input, Textarea } from "@/components/ui/field";
import {
  addFormatRound,
  addPostFormat,
  deleteFormatRound,
  deletePostFormat,
  listFormatRounds,
  listPostFormats,
  pasteFormatRounds,
  updatePostFormat,
  type FormatsResult,
} from "@/lib/post-formats/actions";
import {
  EMPTY_SERIES,
  MAX_ANSWER_NAME,
  DEFAULT_ANSWER_NAME,
  MAX_PASTE_ROUNDS,
  MAX_ROUND_ANSWER,
  MAX_ROUND_WISH,
  MAX_ROUNDS,
  MAX_SERIES_INSTRUCTION,
  ROUND_PROPOSALS,
  SERIES_DAILY_RUNS,
  isSeries,
  type FormatRound,
  type FormatSeries,
} from "@/lib/post-formats/series";
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
  MAX_SLOT_VALUE,
  FORMAT_HASHTAG_KEYS,
  fillFormat,
  unfilledSlots,
  formatInputSchema,
  formatSlots,
  hasFormatHashtags,
  hashtagKeyLabel,
  type FormatHashtagKey,
  type FormatHashtags,
  type PostFormat,
  type PostFormatInput,
} from "@/lib/post-formats/schema";
import type { SnsKey } from "@/lib/sns";
import { MAX_TARGET_HASHTAGS, hashtagLine, normalizeHashtag, parseHashtagInput } from "@/lib/sns/hashtags";
import { Choice } from "./maker-parts";

// 投稿のフォーマットを選んだ状態（整えるに渡す。docs/design/post-formats.md の 4）
// answer: シリーズのこの回の答え（本文には出ない。書きかけの控えに乗せる）
export type FormatUse = { format: PostFormat; values: Record<string, string>; answer?: string };

// 投稿をつくるの「フォーマット」（docs/design/post-formats.md の 4。docs/architecture.md の 4.56）。
// 「なし」と登録したフォーマットのチップ、選んだフォーマットの穴の欄、「本文に入れる」（AI を使わない）。
// その下に畳んだ「フォーマットを管理」（例から足す・手で書く・直す・削除する）。一覧の正はサーバー（操作のたびに返った一覧に入れ替える）
export function PostFormatPicker({
  projectId,
  bodyHasText,
  pillars,
  planHashtags = [],
  connected = [],
  onInsert,
  onUseChange,
  initialFormatId = null,
  initialValues,
  onRoundAdded,
  aiEnabled,
}: {
  projectId: string;
  bodyHasText: boolean;
  // AI とつくる（Claude API のキーがあるときだけ）
  aiEnabled: boolean;
  // アカウント設計の投稿の柱の名前（フォーマットを柱とつなぐ）
  pillars: string[];
  // アカウント設計のハッシュタグの候補（# なし。フォーマットのタグに押して足す）
  planHashtags?: string[];
  // つないだ SNS（SNS ごとのタグの欄は、つないだ SNS を先に出し、ほかは畳む）
  connected?: SnsKey[];
  // hashtags: フォーマットの毎回付けるタグ（SNS ごとのタグの欄に入れる。4.59）
  onInsert: (text: string, how: "replace" | "append", hashtags: FormatHashtags) => void;
  onUseChange?: (use: FormatUse | null) => void;
  // 開いたときに選んでおくフォーマット（下書きから再開したとき。消したフォーマットなら「なし」）。
  // 書きかけの控えから戻したときは、穴の言葉と答えも入れて開く（PMO2 の 3 回目の 03）
  initialFormatId?: string | null;
  initialValues?: { values: Record<string, string>; answer: string };
  // シリーズの記録を付けた（docs/design/format-series.md の 2。画面が、保存で投稿に結びつけ、リセットで消す）
  onRoundAdded?: (id: string) => void;
}) {
  const [formats, setFormats] = useState<PostFormat[] | null>(null);
  const [examples, setExamples] = useState<PostFormatInput[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [how, setHow] = useState<"replace" | "append">("append");
  const [inserted, setInserted] = useState(false);
  // シリーズ: この回の答え（本文には出ない）と、AI の案を使ったか
  const [answer, setAnswer] = useState("");
  const [roundSource, setRoundSource] = useState<"ai" | "hand">("hand");
  const [roundError, setRoundError] = useState<string | null>(null);

  const apply = (r: FormatsResult) => {
    if (r.error) setError(r.error);
    else setError(null);
    if (r.formats) {
      setFormats(r.formats);
      // 選んでいたフォーマットを削除したら「なし」に戻し、直したら直したあとのものを整えるに渡す
      if (selectedId) {
        const now = r.formats.find((f) => f.id === selectedId);
        if (!now) setSelectedId(null);
        onUseChange?.(now ? { format: now, values, answer } : null);
      }
    }
    if (r.examples) setExamples(r.examples);
    if (r.kinds) setKinds(r.kinds);
  };

  useEffect(() => {
    let alive = true;
    void listPostFormats(projectId).then((r) => {
      if (!alive) return;
      setError(r.error ?? null);
      if (r.formats) {
        setFormats(r.formats);
        // 下書きから再開したときは、保存したときに選んでいたフォーマットを選んで開く（穴の言葉は本文に入っているので、欄は空）。
        // 書きかけの控えから戻したときは、穴の言葉と答えも戻す（型の文にない穴は捨てる）
        const first = initialFormatId ? r.formats.find((f) => f.id === initialFormatId) : undefined;
        if (first) {
          const slotNames = formatSlots(first.body);
          const v = Object.fromEntries(Object.entries(initialValues?.values ?? {}).filter(([k]) => slotNames.includes(k)));
          const a = first.series.answer || isSeries(first.series) ? (initialValues?.answer ?? "") : "";
          setSelectedId(first.id);
          setValues(v);
          setAnswer(a);
          onUseChange?.({ format: first, values: v, answer: a });
        }
      }
      if (r.examples) setExamples(r.examples);
      if (r.kinds) setKinds(r.kinds);
    });
    return () => {
      alive = false;
    };
    // 開いたときの選択（initialFormatId）は最初の 1 回だけ使う。リセットでは key が変わって作り直される
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const selected = formats?.find((f) => f.id === selectedId) ?? null;

  function select(f: PostFormat | null) {
    setSelectedId(f?.id ?? null);
    setValues({});
    setInserted(false);
    setAnswer("");
    setRoundSource("hand");
    setRoundError(null);
    onUseChange?.(f ? { format: f, values: {} } : null);
  }

  function setValue(slot: string, v: string) {
    const next = { ...values, [slot]: v };
    setValues(next);
    setInserted(false);
    if (selected) onUseChange?.({ format: selected, values: next, answer });
  }

  // 読み込み中も、読み込んだあとと同じ場所を空けておく（見出し・「なし」・「フォーマットを管理」の 1 行）。
  // 前は読み込むまで何も出さず、あとから欄が出て下の本文の欄がずれ、押した所が「フォーマットを管理」に変わって、打った文字が入らなかった
  // （2026-11-12 PMO の本番での通しテスト 01）
  if (formats === null) {
    return (
      <fieldset className="flex min-w-0 flex-col gap-2" aria-busy={!error || undefined}>
        <legend className="mb-1.5 text-[14px] font-bold">フォーマット</legend>
        <div className="flex flex-wrap gap-2">
          <Choice on onClick={() => {}}>
            なし
          </Choice>
        </div>
        <p className="text-xs text-faint">フォーマットを読み込んでいます…</p>
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </fieldset>
    );
  }
  const slots = selected ? formatSlots(selected.body) : [];
  // 本文に入れたとき、まだ埋めていない穴（【穴の名前】のまま本文に入る）
  const unfilled = selected ? unfilledSlots(selected.body, values) : [];

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1.5 text-[14px] font-bold">フォーマット</legend>
      <div className="flex flex-wrap gap-2">
        <Choice on={selectedId === null} onClick={() => select(null)}>
          なし
        </Choice>
        {formats.map((f) => (
          <Choice key={f.id} on={selectedId === f.id} onClick={() => select(f)}>
            {f.name}
          </Choice>
        ))}
      </div>

      {selected && (
        <div className="flex flex-col gap-2.5 rounded-md border border-line px-4 py-3 max-sm:px-3">
          {selected.purpose && <p className="text-xs text-muted">{selected.purpose}</p>}
          {hasFormatHashtags(selected.hashtags) && <FormatTagsLine h={selected.hashtags} className="text-xs text-muted" />}
          {selected.example && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">埋めた例を見る</summary>
              <p className="mt-1.5 rounded-md bg-surface2 px-3 py-2 text-[13px] leading-[1.7] whitespace-pre-wrap">{selected.example}</p>
            </details>
          )}
          {isSeries(selected.series) && (
            <SeriesNextRound
              key={selected.id}
              projectId={projectId}
              formatId={selected.id}
              series={selected.series}
              aiEnabled={aiEnabled}
              onPick={(p) => {
                const next = { ...values, ...p.values };
                setValues(next);
                setAnswer(p.answer);
                setRoundSource("ai");
                setInserted(false);
                onUseChange?.({ format: selected, values: next, answer: p.answer });
              }}
            />
          )}
          {/* 答えの欄は、シリーズならいつも出す（答えの決まりがなくても、AI の案の答えが入る。直せる） */}
          {(selected.series.answer || isSeries(selected.series)) && (
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-bold">
                {selected.series.answer?.name || DEFAULT_ANSWER_NAME}
                <span className="ml-1.5 font-normal text-muted">答え・本文には出ません</span>
              </span>
              <Input value={answer} maxLength={MAX_ROUND_ANSWER} onChange={(e) => (setAnswer(e.target.value), setInserted(false), onUseChange?.({ format: selected, values, answer: e.target.value }))} className="py-2 text-sm" />
            </label>
          )}
          {slots.length > 0 && (
            // 穴の欄は横いっぱいにし、長い言葉は折り返して全部見えるようにする（前は 2 列の 1 行の欄で、「キーワード5つ」の言葉が途中で切れた。通しテスト 02）。
            // 改行は入れない（Enter では改行しない。言い換えの確定の Enter はそのまま）
            <div className="flex flex-col gap-2">
              {slots.map((s) => (
                <label key={s} className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs font-bold">
                    {s}
                    {s in selected.series.slots && <span className="ml-1.5 font-normal text-muted">AI が埋める穴・直せます</span>}
                  </span>
                  <Textarea
                    rows={1}
                    value={values[s] ?? ""}
                    maxLength={MAX_SLOT_VALUE}
                    onChange={(e) => setValue(s, e.target.value.replace(/\r?\n/g, " "))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
                    }}
                    className="min-h-0 resize-none! py-2 text-sm [field-sizing:content]"
                  />
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                onInsert(fillFormat(selected.body, values), how, selected.hashtags);
                setInserted(true);
                // シリーズのフォーマットなら、この回を記録する（次の回の案で重ならないように）
                if (isSeries(selected.series)) {
                  setRoundError(null);
                  void addFormatRound(projectId, selected.id, { answer, values, source: roundSource }).then((r) => {
                    if (r.error) setRoundError(`本文には入れましたが、シリーズの記録に残せませんでした。${r.error}`);
                    else if (r.id) onRoundAdded?.(r.id);
                  });
                }
              }}
            >
              本文に入れる
            </Button>
            {bodyHasText && (
              <span role="radiogroup" aria-label="いまの本文" className="flex items-center gap-2 text-xs text-muted">
                {(["append", "replace"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1">
                    <input type="radio" name="format-insert" checked={how === k} onChange={() => setHow(k)} className="accent-[var(--primary)]" />
                    {k === "append" ? "いまの本文の下に足す" : "いまの本文を置きかえる"}
                  </label>
                ))}
              </span>
            )}
          </div>
          {roundError && <p className="text-xs font-semibold text-danger">{roundError}</p>}
          {inserted && (
            <p className="text-xs font-semibold text-success">
              {/* 全部埋めたときは【】の案内を出さない（前は埋めても「【】で残っています」と出た。通しテスト 02） */}
              {unfilled.length > 0 ? `本文に入れました。埋めなかったところ（${unfilled.join("・")}）は【】で残っているので、書き換えてください。` : "本文に入れました。"}
              {hasFormatHashtags(selected.hashtags) && "タグは本文の下に付き、「2 送り先」で SNS ごとに直せます。"}
            </p>
          )}
        </div>
      )}

      <FormatManager projectId={projectId} formats={formats} examples={examples} kinds={kinds} pillars={pillars} planHashtags={planHashtags} connected={connected} aiEnabled={aiEnabled} onChange={apply} />
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </fieldset>
  );
}

// 畳んだ「フォーマットを管理」: 一覧（直す・削除する）、例から足す、手で書く
function FormatManager({
  projectId,
  formats,
  examples,
  kinds,
  pillars,
  planHashtags,
  connected,
  aiEnabled,
  onChange,
}: {
  projectId: string;
  formats: PostFormat[];
  examples: PostFormatInput[];
  kinds: string[];
  pillars: string[];
  planHashtags: string[];
  connected: SnsKey[];
  aiEnabled: boolean;
  onChange: (r: FormatsResult) => void;
}) {
  const [pending, start] = useTransition();
  // 直している行の id、"new"（手で書く・AI の案を直す）、"ai"（AI とつくる）
  const [editing, setEditing] = useState<string | "new" | "ai" | null>(null);
  // AI の案から始めるときの中身
  const [draft, setDraft] = useState<PostFormatInput | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const run = (fn: () => Promise<FormatsResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      onChange(r);
      if (!r.error) after?.();
    });
  const left = MAX_POST_FORMATS - formats.length;
  const addable = examples.filter((e) => !formats.some((f) => f.name === e.name));

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-muted">
        フォーマットを管理（<span className="num">{formats.length}</span> / {MAX_POST_FORMATS}）
      </summary>
      <div className="mt-2 flex flex-col gap-3 rounded-md border border-line bg-surface px-3 py-2.5">
        <p className="text-xs leading-[1.7] text-muted">
          くり返し出す投稿の型です。本文に {"{何が}"} のように穴を置くと、投稿をつくるときに穴ごとの欄が出ます（{MAX_FORMAT_SLOTS} 種類まで）。
        </p>
        {formats.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {formats.map((f) =>
              editing === f.id ? (
                <li key={f.id} className="py-2">
                  <FormatEditor initial={f} pillars={pillars} planHashtags={planHashtags} connected={connected} pending={pending} onCancel={() => setEditing(null)} onSave={(v) => run(() => updatePostFormat(projectId, f.id, v), () => setEditing(null))} />
                </li>
              ) : (
                <li key={f.id} className="flex flex-col gap-1 py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-bold">{f.name}</span>
                    {f.pillar && <span className="text-xs text-muted">柱: {pillars.includes(f.pillar) ? f.pillar : "なし"}</span>}
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="text" onClick={() => setEditing(f.id)}>
                        直す
                      </Button>
                      {confirmDelete === f.id ? (
                        <>
                          <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => deletePostFormat(projectId, f.id), () => setConfirmDelete(null))}>
                            本当に削除する
                          </Button>
                          <Button size="sm" variant="text" onClick={() => setConfirmDelete(null)}>
                            やめる
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="text" onClick={() => setConfirmDelete(f.id)}>
                          削除する
                        </Button>
                      )}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs leading-[1.7] whitespace-pre-line text-muted">{f.body}</p>
                  {hasFormatHashtags(f.hashtags) && <FormatTagsLine h={f.hashtags} className="text-xs text-muted" />}
                  {isSeries(f.series) && <SeriesRounds projectId={projectId} format={f} />}
                </li>
              ),
            )}
          </ul>
        )}
        {left > 0 &&
          (editing === "new" ? (
            <FormatEditor
              key={draft?.name ?? "new"}
              initial={draft ?? undefined}
              pillars={pillars}
              planHashtags={planHashtags}
              connected={connected}
              pending={pending}
              onCancel={() => (setEditing(null), setDraft(null))}
              onSave={(v) => run(() => addPostFormat(projectId, v), () => (setEditing(null), setDraft(null)))}
            />
          ) : editing === "ai" ? (
            <FormatAiMaker projectId={projectId} kinds={[...pillars, ...kinds.filter((k) => !pillars.includes(k))]} onPick={(p) => (setDraft(p), setEditing("new"))} onCancel={() => setEditing(null)} />
          ) : (
            <div className="flex flex-col gap-1.5">
              {addable.length > 0 && (
                <>
                  <span className="text-xs font-bold">例から足す</span>
                  <div className="flex flex-wrap gap-2">
                    {addable.map((e) => (
                      <Button key={e.name} size="sm" variant="secondary" disabled={pending} onClick={() => run(() => addPostFormat(projectId, e))}>
                        ＋ {e.name}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              <span className="flex flex-wrap gap-2">
                {aiEnabled ? (
                  <Button size="sm" variant="secondary" onClick={() => setEditing("ai")}>
                    AI とつくる
                  </Button>
                ) : (
                  <NotReadyButton size="sm" variant="secondary">
                    AI とつくる
                  </NotReadyButton>
                )}
                <Button size="sm" variant="text" onClick={() => (setDraft(null), setEditing("new"))}>
                  手で書く
                </Button>
              </span>
            </div>
          ))}
      </div>
    </details>
  );
}

// フォーマットの欄（名前・いつ使う・本文・埋めた例・柱）。保存の前に画面でも確かめる（正はサーバー）
function FormatEditor({
  initial,
  pillars,
  planHashtags,
  connected,
  pending,
  onSave,
  onCancel,
}: {
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
  // シリーズ（AI が埋める穴と答え。docs/design/format-series.md の 1）
  const [series, setSeries] = useState<FormatSeries>(initial?.series ?? EMPTY_SERIES);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (k: Exclude<keyof PostFormatInput, "hashtags" | "series">, x: string) => (setV((o) => ({ ...o, [k]: x })), setProblem(null));
  const setTag = (k: FormatHashtagKey, x: string) => (setTags((o) => ({ ...o, [k]: x })), setProblem(null));
  const slots = formatSlots(v.body);

  return (
    <div className="flex flex-col gap-2.5">
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
        <Textarea value={v.body} maxLength={MAX_FORMAT_BODY} rows={4} onChange={(e) => set("body", e.target.value)} placeholder={"例: 【新メニュー】{何が}\n{いつから}から、{いくら}でお出しします。"} className="py-2 text-sm" />
        <span className="text-xs text-muted">{slots.length ? `穴: ${slots.join("・")}` : "{ } で囲んだところが穴になります"}</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold">
          埋めた例<span className="ml-1.5 font-normal text-muted">任意</span>
        </span>
        <Textarea value={v.example} maxLength={MAX_FORMAT_EXAMPLE} rows={3} onChange={(e) => set("example", e.target.value)} placeholder="穴を埋めた投稿の例。何を書けばいいかの手がかりになります" className="py-2 text-sm" />
      </label>
      {pillars.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold">
            投稿の柱<span className="ml-1.5 font-normal text-muted">任意</span>
          </span>
          <select value={pillars.includes(v.pillar) ? v.pillar : ""} onChange={(e) => set("pillar", e.target.value)} className="rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm max-sm:text-[16px]">
            <option value="">柱なし</option>
            {pillars.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
      <FormatTagsFields tags={tags} setTag={setTag} planHashtags={planHashtags} connected={connected} />
      {slots.length > 0 && <SeriesFields slots={slots} series={series} setSeries={(x) => (setSeries(x), setProblem(null))} />}
      {problem && <p className="text-sm font-semibold text-danger">{problem}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || !v.name.trim() || !v.body.trim()}
          onClick={() => {
            const p = formatInputSchema.safeParse({ ...v, pillar: pillars.includes(v.pillar) ? v.pillar : "", hashtags: tags, series });
            if (!p.success) return setProblem(p.error.issues[0]?.message ?? "入力の形式が正しくありません。");
            onSave(p.data);
          }}
        >
          {pending ? "保存しています…" : "保存する"}
        </Button>
        <Button size="sm" variant="text" onClick={onCancel}>
          やめる
        </Button>
      </div>
    </div>
  );
}

// フォーマットのタグを 1 行で（全部の SNS のタグと、SNS だけのタグ）
function FormatTagsLine({ h, className }: { h: FormatHashtags; className?: string }) {
  const parts = FORMAT_HASHTAG_KEYS.filter((k) => h[k]?.length).map((k) => `${k === "all" ? "" : `${hashtagKeyLabel(k)}: `}${hashtagLine(h[k]!)}`);
  return <p className={`break-words ${className ?? ""}`}>タグ {parts.join(" ／ ")}</p>;
}

// 毎回付けるタグの欄（docs/architecture.md の 4.59）。全部の SNS に付けるタグと、畳んだ「SNS ごとに変える」。
// アカウント設計のハッシュタグの候補は、押すと全部の SNS の欄に足す
function FormatTagsFields({
  tags,
  setTag,
  planHashtags,
  connected,
}: {
  tags: Partial<Record<FormatHashtagKey, string>>;
  setTag: (k: FormatHashtagKey, x: string) => void;
  planHashtags: string[];
  connected: SnsKey[];
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
        毎回付けるタグ<span className="ml-1.5 font-normal text-muted">任意</span>
      </legend>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">全部の SNS（{MAX_TARGET_HASHTAGS} 個まで）</span>
        <Input value={tags.all ?? ""} maxLength={400} onChange={(e) => setTag("all", e.target.value)} placeholder="例: #個人開発 #indiedev" className="py-2 text-sm" />
      </label>
      {candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">設計の候補:</span>
          {candidates.map((t) => (
            <Button key={t} type="button" size="sm" variant="text" onClick={() => setTag("all", `${(tags.all ?? "").trim()} #${t}`.trim())}>
              ＋ #{t}
            </Button>
          ))}
        </div>
      )}
      <details className="text-xs" open={perSns.some((k) => (tags[k] ?? "").trim() !== "")}>
        <summary className="cursor-pointer text-muted">SNS ごとに変える</summary>
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-2 max-sm:grid-cols-1">{shown.map(field)}</div>
        {rest.length > 0 && (
          <details className="mt-2" open={rest.some((k) => (tags[k] ?? "").trim() !== "")}>
            <summary className="cursor-pointer text-muted">つないでいない SNS（{rest.map((k) => hashtagKeyLabel(k)).join("・")}）</summary>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-2 max-sm:grid-cols-1">{rest.map(field)}</div>
          </details>
        )}
      </details>
      <span className="text-xs text-muted">本文の下に 1 行あけて付きます。投稿ごとに「2 送り先」で直せます。</span>
    </fieldset>
  );
}

// AI とつくる（docs/design/post-formats.md の 3）: 何の投稿か → 決まって入れたいこと → 案 3 つ（理由つき）→ 選ぶと欄に入って直してから保存する。案は保存しない
function FormatAiMaker({ projectId, kinds, onPick, onCancel }: { projectId: string; kinds: string[]; onPick: (p: PostFormatInput) => void; onCancel: () => void }) {
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
      if (r.error || !r.proposals) setError(r.error ?? "うまくいきませんでした。");
      else setProposals(r.proposals);
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold">何の投稿の型をつくりますか</span>
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
          決まって入れたいこと<span className="ml-1.5 font-normal text-muted">任意</span>
        </span>
        <Input value={must} maxLength={MAX_FORMAT_MUST} onChange={(e) => setMust(e.target.value)} placeholder="例: 最後に予約の案内を入れたい" className="py-2 text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" disabled={pending || !chosen} onClick={() => ask(false)}>
          {pending ? "考えています…" : proposals ? "案を出し直す" : "AI に案を出してもらう"}
        </Button>
        <span className="text-xs text-muted">1 回 5〜10 円ほど。1 日 {POST_FORMAT_DAILY_RUNS} 回まで</span>
        <Button size="sm" variant="text" onClick={onCancel}>
          やめる
        </Button>
      </div>
      {pending && <AiThinking kind="brief" note="10〜20 秒ほどかかります" />}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {proposals && !pending && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold">案（選ぶと下の欄に入ります。直してから保存します）</span>
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
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted">埋めた例を見る</summary>
                    <p className="mt-1.5 text-[13px] leading-[1.7] whitespace-pre-wrap">{p.example}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="案への希望" value={refine} maxLength={MAX_FORMAT_REFINE} onChange={(e) => setRefine(e.target.value)} placeholder="もう少しこうしたい（例: もっと短く）" className="min-w-0 flex-1 py-2 text-sm max-sm:basis-full" />
            <Button size="sm" variant="secondary" disabled={pending || !refine.trim() || !chosen} onClick={() => ask(true)}>
              この希望で出し直す
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// フォーマットの編集の「シリーズ」（docs/design/format-series.md の 1）。穴ごとに「AI が埋める」を選び、短い指示を書く。
// 本文に出さない答え（例: 映画）も 1 つ持てる。AI の穴が 1 つでもあれば、投稿をつくるで「AI に次の回を出してもらう」が出る
function SeriesFields({ slots, series, setSeries }: { slots: string[]; series: FormatSeries; setSeries: (s: FormatSeries) => void }) {
  const on = Object.keys(series.slots).some((k) => slots.includes(k));
  return (
    <details className="text-xs" open={on || undefined}>
      <summary className="cursor-pointer font-bold">
        シリーズにする<span className="ml-1.5 font-normal text-muted">任意・一部の穴を AI が毎回埋める</span>
      </summary>
      <div className="mt-2 flex flex-col gap-2.5">
        <p className="leading-[1.7] text-muted">AI が埋める穴を選ぶと、投稿をつくるときに、前の回と重ならない次の回の案を AI が出します（例: 連想映画クイズの映画とキーワード）。</p>
        {slots.map((name) => {
          const ai = name in series.slots;
          return (
            <div key={name} className="flex flex-col gap-1">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ai}
                  onChange={(e) => {
                    const next = { ...series.slots };
                    if (e.target.checked) next[name] = "";
                    else delete next[name];
                    setSeries({ ...series, slots: next });
                  }}
                  className="accent-[var(--primary)]"
                />
                <span className="font-bold">{name}</span>
                <span className="text-muted">を AI が埋める</span>
              </label>
              {ai && (
                <Input
                  aria-label={`${name} の AI への指示`}
                  value={series.slots[name]}
                  maxLength={MAX_SERIES_INSTRUCTION}
                  onChange={(e) => setSeries({ ...series, slots: { ...series.slots, [name]: e.target.value } })}
                  placeholder="AI への指示（例: 答えの映画を連想できる言葉を 5 つ。・でつなぐ）"
                  className="py-2 text-sm"
                />
              )}
            </div>
          );
        })}
        {on && (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={series.answer !== null}
                onChange={(e) => setSeries({ ...series, answer: e.target.checked ? { name: "", instruction: "" } : null })}
                className="accent-[var(--primary)]"
              />
              <span className="font-bold">本文に出さない答えを、AI に先に決めてもらう</span>
            </label>
            {series.answer && (
              <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2 max-sm:grid-cols-1">
                <Input
                  aria-label="答えの名前"
                  value={series.answer.name}
                  maxLength={MAX_ANSWER_NAME}
                  onChange={(e) => setSeries({ ...series, answer: { ...series.answer!, name: e.target.value } })}
                  placeholder="名前（例: 映画。空なら「答え」）"
                  className="py-2 text-sm"
                />
                <Input
                  aria-label="答えの AI への指示"
                  value={series.answer.instruction}
                  maxLength={MAX_SERIES_INSTRUCTION}
                  onChange={(e) => setSeries({ ...series, answer: { ...series.answer!, instruction: e.target.value } })}
                  placeholder="AI への指示（例: だれでも知っている映画を 1 つ）"
                  className="py-2 text-sm"
                />
              </div>
            )}
            <span className="text-muted">答えは前の回と重ならないように使います。投稿には入りません。</span>
          </div>
        )}
      </div>
    </details>
  );
}

// 投稿をつくるの「AI に次の回を出してもらう」（docs/design/format-series.md の 3）。案は 3 つ。選ぶと穴の欄と答えに入る（直せる）
function SeriesNextRound({
  projectId,
  formatId,
  series,
  aiEnabled,
  onPick,
}: {
  projectId: string;
  formatId: string;
  series: FormatSeries;
  aiEnabled: boolean;
  onPick: (p: RoundProposal) => void;
}) {
  const [wish, setWish] = useState("");
  const [proposals, setProposals] = useState<RoundProposal[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [dropped, setDropped] = useState(0);
  const [failedOnce, setFailedOnce] = useState(false);
  // AI は呼んだが、捨てて案が残らなかった（わけと数え方を「?」に畳む）
  const [empty, setEmpty] = useState(false);
  const [pending, start] = useTransition();
  const ask = () =>
    start(async () => {
      setError(null);
      setPicked(null);
      const r = await draftFormatRound(projectId, formatId, wish);
      // 今日の残りの回数と、捨てた案の数（案が 1〜2 つしか残らなかったとき、なぜ少ないかを添える）
      setLeft(r.left ?? null);
      setDropped(r.dropped ?? 0);
      if (r.error || !r.proposals) {
        setError(r.error ?? "うまくいきませんでした。");
        // 前の案は使えるので残す（今回の案がなかったことは、上の文で伝える）
        setFailedOnce(true);
        setEmpty(Boolean(r.empty));
      } else {
        setFailedOnce(false);
        setProposals(r.proposals);
      }
    });
  if (!aiEnabled) {
    return (
      <NotReadyButton size="sm" variant="secondary" className="self-start">
        AI に次の回を出してもらう
      </NotReadyButton>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={ask}>
          {pending ? "考えています…" : failedOnce ? "もう一度出してもらう" : proposals ? "ほかの案を出してもらう" : "AI に次の回を出してもらう"}
        </Button>
        <span className="text-xs text-muted">前の回と重ならない案を 3 つ。1 回 5 円ほど・1 日 {SERIES_DAILY_RUNS} 回まで</span>
      </div>
      <Input aria-label="次の回への希望" value={wish} maxLength={MAX_ROUND_WISH} onChange={(e) => setWish(e.target.value)} placeholder="希望（任意。例: 90 年代の映画で）" className="py-2 text-sm" />
      {pending && <AiThinking kind="brief" note="10〜20 秒ほどかかります" />}
      {error &&
        (empty ? (
          // 文の後ろに「?」を続けて置く（前は flex で、PC で「?」だけ 3 行目に回った）。朱は先頭の印だけ（朱は印に使う決まり）
          <p className="text-[13px] leading-[1.7] font-semibold text-danger">
            <span aria-hidden className="mr-1 text-signal">
              ●
            </span>
            {error}{" "}
            <HelpTip label="案が出なかったわけ">
              AI の案が、どれも前の回と重なっていたか、穴の決まり（言葉の数など）に合わなかったので、除きました。AI はもう使ったので、今日の {SERIES_DAILY_RUNS} 回のうち 1 回に数えています。
            </HelpTip>
          </p>
        ) : (
          <ErrorBanner>{error}</ErrorBanner>
        ))}
      {proposals && !pending && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-fg">
            <span aria-hidden className="mr-1 text-signal">
              ●
            </span>
            AI は作品やものごとの中身を間違えることがあります。出す前に確かめてください。
          </p>
          {!failedOnce && dropped > 0 && proposals.length < ROUND_PROPOSALS && (
            <p className="text-xs leading-[1.7] text-muted">
              前の回と重なる案を除いたので、案は {proposals.length} つです{left !== null ? `（今日はあと ${left} 回）` : ""}。{" "}
              <HelpTip label="案が少ないわけ">前の回と重なる案や、穴の決まり（言葉の数など）に合わない案を除きました。「ほかの案を出してもらう」も、1 回に数えます。</HelpTip>
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {proposals.map((p, i) => (
              <li key={i} className={`flex flex-col gap-1.5 rounded-md border bg-surface px-3 py-2.5 ${picked === i ? "border-primary" : "border-line"}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {/* 答えはいつも出す（答えの決まりがなくても AI が書いたとき。本文には出ない。PMO2 の 3 回目の n1） */}
                  {p.answer && (
                    <span className="font-bold">
                      {series.answer?.name || DEFAULT_ANSWER_NAME}: {p.answer}
                      <span className="ml-1.5 text-xs font-normal text-muted">本文には出ません</span>
                    </span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={picked === i ? "primary" : "secondary"}
                    className="ml-auto"
                    onClick={() => {
                      setPicked(i);
                      onPick(p);
                    }}
                  >
                    {picked === i ? "使っています" : "これを使う"}
                  </Button>
                </div>
                <dl className="flex flex-col gap-0.5 text-[13px]">
                  {Object.entries(p.values).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="shrink-0 text-muted">{k}</dt>
                      <dd className="min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
                {p.checks.length > 0 && (
                  <div className="text-xs leading-[1.7] text-muted">
                    <span className="font-bold text-fg">確かめてほしいところ</span>
                    <ul className="list-disc pl-5">
                      {p.checks.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// フォーマットを管理の「これまでの回」（docs/design/format-series.md の 2）。開いたときに読む。消す・これまでの回を貼る
function SeriesRounds({ projectId, format }: { projectId: string; format: PostFormat }) {
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
  const label = format.series.answer?.name || "回";
  const answerName = format.series.answer?.name || DEFAULT_ANSWER_NAME;
  return (
    <details
      className="text-xs"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && rounds === null) run(() => listFormatRounds(projectId, format.id));
      }}
    >
      <summary className="cursor-pointer text-muted">シリーズのこれまでの回{rounds ? `（${rounds.length} / ${MAX_ROUNDS}）` : ""}</summary>
      <div className="mt-1.5 flex flex-col gap-2">
        {rounds === null && !error && <p className="text-faint">読み込んでいます…</p>}
        {rounds && rounds.length === 0 && <p className="text-muted">まだありません。投稿をつくるで本文に入れると、ここに残ります。</p>}
        {rounds && rounds.length > 0 && (
          <ul className="flex max-h-60 flex-col divide-y divide-line overflow-y-auto rounded-md border border-line">
            {rounds.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-2.5 py-1.5">
                {/* 答えがあれば答えを先に出し、穴の言葉を添える（PMO2 の 3 回目の n2） */}
                <span className="min-w-0 flex-1 truncate">
                  {r.answer ? (
                    <>
                      <b>
                        {answerName}: {r.answer}
                      </b>
                      {Object.keys(r.values).length > 0 && <span className="ml-1.5 text-muted">{Object.values(r.values).join(" / ")}</span>}
                    </>
                  ) : (
                    Object.values(r.values).join(" / ")
                  )}
                  <span className="ml-1.5 text-faint">{r.source === "pasted" ? "貼った回" : r.postId ? "投稿した回" : "本文に入れた回"}</span>
                </span>
                <Button size="sm" variant="text" disabled={pending} onClick={() => run(() => deleteFormatRound(projectId, format.id, r.id))}>
                  消す
                </Button>
              </li>
            ))}
          </ul>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-bold">これまでの回を貼る</span>
          <span className="text-muted">
            yabumi の外で出した回の{label}を、1 行に 1 つ（1 回に {MAX_PASTE_ROUNDS} 行まで）。次の回の案で重ならないように使います。
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
                setNote(`${r.added ?? 0} 回を足しました。${r.skipped ? `同じものなど ${r.skipped} 行は足していません。` : ""}${r.overflow ? `上限のため ${r.overflow} 行は足していません。` : ""}`);
              },
            )
          }
        >
          足す
        </Button>
        {note && <p className="font-semibold text-success">{note}</p>}
        {error && <p className="font-semibold text-danger">{error}</p>}
      </div>
    </details>
  );
}
