"use client";

import { useEffect, useState, useTransition } from "react";
import { AiThinking } from "@/components/ui/ai-thinking";
import { Button, NotReadyButton } from "@/components/ui/button";
import { draftPostFormats } from "@/lib/ai/post-format-actions";
import type { FormatProposal } from "@/lib/ai/post-format-ai";
import { ErrorBanner } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/field";
import { addPostFormat, deletePostFormat, listPostFormats, updatePostFormat, type FormatsResult } from "@/lib/post-formats/actions";
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
  formatInputSchema,
  formatSlots,
  hasFormatHashtags,
  hashtagKeyLabel,
  type FormatHashtagKey,
  type FormatHashtags,
  type PostFormat,
  type PostFormatInput,
} from "@/lib/post-formats/schema";
import { MAX_TARGET_HASHTAGS, hashtagLine, normalizeHashtag, parseHashtagInput } from "@/lib/sns/hashtags";
import { Choice } from "./maker-parts";

// 投稿のフォーマットを選んだ状態（整えるに渡す。docs/design/post-formats.md の 4）
export type FormatUse = { format: PostFormat; values: Record<string, string> };

// 投稿をつくるの「フォーマット」（docs/design/post-formats.md の 4。docs/architecture.md の 4.56）。
// 「なし」と登録したフォーマットのチップ、選んだフォーマットの穴の欄、「本文に入れる」（AI を使わない）。
// その下に畳んだ「フォーマットを管理」（例から足す・手で書く・直す・削除する）。一覧の正はサーバー（操作のたびに返った一覧に入れ替える）
export function PostFormatPicker({
  projectId,
  bodyHasText,
  pillars,
  planHashtags = [],
  onInsert,
  onUseChange,
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
  // hashtags: フォーマットの毎回付けるタグ（SNS ごとのタグの欄に入れる。4.59）
  onInsert: (text: string, how: "replace" | "append", hashtags: FormatHashtags) => void;
  onUseChange?: (use: FormatUse | null) => void;
}) {
  const [formats, setFormats] = useState<PostFormat[] | null>(null);
  const [examples, setExamples] = useState<PostFormatInput[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [how, setHow] = useState<"replace" | "append">("append");
  const [inserted, setInserted] = useState(false);

  const apply = (r: FormatsResult) => {
    if (r.error) setError(r.error);
    else setError(null);
    if (r.formats) {
      setFormats(r.formats);
      // 選んでいたフォーマットを削除したら「なし」に戻し、直したら直したあとのものを整えるに渡す
      if (selectedId) {
        const now = r.formats.find((f) => f.id === selectedId);
        if (!now) setSelectedId(null);
        onUseChange?.(now ? { format: now, values } : null);
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
      if (r.formats) setFormats(r.formats);
      if (r.examples) setExamples(r.examples);
      if (r.kinds) setKinds(r.kinds);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const selected = formats?.find((f) => f.id === selectedId) ?? null;

  function select(f: PostFormat | null) {
    setSelectedId(f?.id ?? null);
    setValues({});
    setInserted(false);
    onUseChange?.(f ? { format: f, values: {} } : null);
  }

  function setValue(slot: string, v: string) {
    const next = { ...values, [slot]: v };
    setValues(next);
    setInserted(false);
    if (selected) onUseChange?.({ format: selected, values: next });
  }

  if (formats === null) return error ? <ErrorBanner>{error}</ErrorBanner> : null;
  const slots = selected ? formatSlots(selected.body) : [];

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
          {slots.length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 max-sm:grid-cols-1">
              {slots.map((s) => (
                <label key={s} className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs font-bold">{s}</span>
                  <Input
                    value={values[s] ?? ""}
                    maxLength={MAX_SLOT_VALUE}
                    onChange={(e) => setValue(s, e.target.value)}
                    className="py-2 text-sm"
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
          {inserted && (
            <p className="text-xs font-semibold text-success">
              本文に入れました。埋めなかったところは【】で残っているので、書き換えてください。
              {hasFormatHashtags(selected.hashtags) && "タグは本文の下に付き、「2 送り先」で SNS ごとに直せます。"}
            </p>
          )}
        </div>
      )}

      <FormatManager projectId={projectId} formats={formats} examples={examples} kinds={kinds} pillars={pillars} planHashtags={planHashtags} aiEnabled={aiEnabled} onChange={apply} />
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
  aiEnabled,
  onChange,
}: {
  projectId: string;
  formats: PostFormat[];
  examples: PostFormatInput[];
  kinds: string[];
  pillars: string[];
  planHashtags: string[];
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
                  <FormatEditor initial={f} pillars={pillars} planHashtags={planHashtags} pending={pending} onCancel={() => setEditing(null)} onSave={(v) => run(() => updatePostFormat(projectId, f.id, v), () => setEditing(null))} />
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
  pending,
  onSave,
  onCancel,
}: {
  initial?: PostFormatInput;
  pillars: string[];
  planHashtags: string[];
  pending: boolean;
  onSave: (v: PostFormatInput) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<PostFormatInput>(initial ?? { name: "", purpose: "", body: "", example: "", pillar: "", hashtags: {} });
  // 毎回付けるタグの欄（書いたままの文字。保存するときにタグの配列にする）
  const [tags, setTags] = useState<Partial<Record<FormatHashtagKey, string>>>(() =>
    Object.fromEntries(FORMAT_HASHTAG_KEYS.filter((k) => initial?.hashtags?.[k]?.length).map((k) => [k, hashtagLine(initial!.hashtags[k]!)])),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const set = (k: Exclude<keyof PostFormatInput, "hashtags">, x: string) => (setV((o) => ({ ...o, [k]: x })), setProblem(null));
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
      <FormatTagsFields tags={tags} setTag={setTag} planHashtags={planHashtags} />
      {problem && <p className="text-sm font-semibold text-danger">{problem}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || !v.name.trim() || !v.body.trim()}
          onClick={() => {
            const p = formatInputSchema.safeParse({ ...v, pillar: pillars.includes(v.pillar) ? v.pillar : "", hashtags: tags });
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
}: {
  tags: Partial<Record<FormatHashtagKey, string>>;
  setTag: (k: FormatHashtagKey, x: string) => void;
  planHashtags: string[];
}) {
  const allTags = parseHashtagInput(tags.all ?? "").tags.map((t) => t.toLowerCase());
  const candidates = planHashtags.map(normalizeHashtag).filter((t) => t && !allTags.includes(t.toLowerCase()));
  const perSns = FORMAT_HASHTAG_KEYS.filter((k) => k !== "all");
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
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-2 max-sm:grid-cols-1">
          {perSns.map((k) => (
            <label key={k} className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-bold">{hashtagKeyLabel(k)}</span>
              <Input value={tags[k] ?? ""} maxLength={400} onChange={(e) => setTag(k, e.target.value)} placeholder="空なら全部の SNS と同じ" className="py-2 text-sm" />
            </label>
          ))}
        </div>
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
