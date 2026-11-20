"use client";

import { useEffect, useState, useTransition } from "react";
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
import {
  EMPTY_SERIES,
  MAX_ANSWER_NAME,
  DEFAULT_ANSWER_NAME,
  MAX_PASTE_ROUNDS,
  MAX_ROUNDS,
  MAX_SERIES_INSTRUCTION,
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
  FORMAT_HASHTAG_KEYS,
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
import { FormatImageFields } from "@/components/posts/format-image-fields";
import { Choice } from "@/components/posts/maker-parts";
import { ErrorBanner } from "@/components/ui/feedback";
import { EMPTY_IMAGE, cleanFormatImage, imageSummary } from "@/lib/post-formats/image";
import { DisclosureBox } from "@/components/ui/disclosure";

// フォーマットの画面（/projects/[id]/formats。2026-11-18 オーナーの了承で、投稿をつくるの中の畳んだ「フォーマットを管理」から移した）:
// 作る（例から足す・AI とつくる・手で書く）、一覧（直す・これまでの回・削除する）。一覧の正はサーバー（操作のたびに返った一覧に入れ替える）。
// シリーズにして保存したとき（AI が埋める穴が 0 → 1 以上）は、その場で「これまでの回を貼る」を開いて出す（docs/design/format-series.md の 2）
export function FormatManager({
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
  // シリーズにしたばかりのフォーマット（これまでの回を貼る案内を出す）
  const [justSeries, setJustSeries] = useState<string | null>(null);
  // 保存したばかりのフォーマット（その行に「保存しました」を出す。前は何も出なかった。パワポの 5）
  const [saved, setSaved] = useState<string | null>(null);
  const run = (fn: () => Promise<FormatsResult>, after?: (r: FormatsResult) => void) =>
    start(async () => {
      const r = await fn();
      onChange(r);
      if (!r.error) after?.(r);
    });
  // 保存のあと、AI が埋める穴が 0 から 1 以上になったフォーマットを探す（新しく作ったものは、前の一覧になかった id）
  const becameSeries = (r: FormatsResult, id: string | null, before: PostFormat | undefined) => {
    const after = r.formats?.find((f) => (id ? f.id === id : !formats.some((o) => o.id === f.id)));
    if (after) setSaved(after.id);
    if (after && isSeries(after.series) && !(before && isSeries(before.series))) setJustSeries(after.id);
  };
  const left = MAX_POST_FORMATS - formats.length;
  const addable = examples.filter((e) => !formats.some((f) => f.name === e.name));

  return (
    <div className="flex flex-col gap-3 text-sm">
        <p className="text-[14px] leading-[1.7] text-muted">
          くり返し出す投稿の型です。投稿をつくるの「フォーマットから」で使います。本文に {"{何が}"} のように空欄を置くと、投稿をつくるときに空欄ごとの欄が出ます（{MAX_FORMAT_SLOTS} 種類まで。<span className="num">{formats.length}</span> / {MAX_POST_FORMATS}）。
        </p>
        {formats.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {formats.map((f) =>
              editing === f.id ? (
                <li key={f.id} className="py-2">
                  <FormatEditor projectId={projectId} initial={f} pillars={pillars} planHashtags={planHashtags} connected={connected} pending={pending} onCancel={() => setEditing(null)} onSave={(v) => run(() => updatePostFormat(projectId, f.id, v), (r) => (setEditing(null), becameSeries(r, f.id, f)))} />
                </li>
              ) : (
                <li key={f.id} className="flex flex-col gap-1 py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-bold">{f.name}</span>
                    {f.pillar && <span className="text-xs text-muted">柱: {pillars.includes(f.pillar) ? f.pillar : "なし"}</span>}
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => (setEditing(f.id), setSaved(null))}>
                        編集
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
                        <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(f.id)}>
                          削除する
                        </Button>
                      )}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs leading-[1.7] whitespace-pre-line text-muted">{f.body}</p>
                  {hasFormatHashtags(f.hashtags) && <FormatTagsLine h={f.hashtags} className="text-xs text-muted" />}
                  {f.image && <p className="text-xs text-muted">{imageSummary(f.image)}</p>}
                  {saved === f.id && (
                    <p role="status" className="text-xs font-semibold text-success">
                      保存しました。
                    </p>
                  )}
                  {isSeries(f.series) && justSeries === f.id && (
                    <p className="mt-1 rounded-md bg-subtle px-3 py-2 text-[13px] font-bold">これまでに出した回はありますか？　貼ると、次の回の案と重なりません</p>
                  )}
                  {isSeries(f.series) && <SeriesRounds key={justSeries === f.id ? "open" : "closed"} projectId={projectId} format={f} open={justSeries === f.id} />}
                </li>
              ),
            )}
          </ul>
        )}
        {left > 0 &&
          (editing === "new" ? (
            <FormatEditor
              key={draft?.name ?? "new"}
              projectId={projectId}
              initial={draft ?? undefined}
              pillars={pillars}
              planHashtags={planHashtags}
              connected={connected}
              pending={pending}
              onCancel={() => (setEditing(null), setDraft(null))}
              onSave={(v) => run(() => addPostFormat(projectId, v), (r) => (setEditing(null), setDraft(null), becameSeries(r, null, undefined)))}
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
                <Button size="sm" variant="secondary" onClick={() => (setDraft(null), setEditing("new"))}>
                  手で書く
                </Button>
              </span>
            </div>
          ))}
    </div>
  );
}

// フォーマットの欄（名前・いつ使う・本文・埋めた例・柱）。保存の前に画面でも確かめる（正はサーバー）
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
  // シリーズ（AI が埋める穴と答え。docs/design/format-series.md の 1）
  const [series, setSeries] = useState<FormatSeries>(initial?.series ?? EMPTY_SERIES);
  // 画像（docs/design/format-image.md の 1.）。絵の説明が空なら画像なしで保存する
  const [image, setImage] = useState(initial?.image ?? EMPTY_IMAGE);
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
        <span className="text-xs text-muted">{slots.length ? `空欄: ${slots.join("・")}` : "{ } で囲んだところが空欄になります"}</span>
      </label>
      {/* 毎回 AI に変えてもらう（シリーズ）は本文のすぐ下に出す（前はいちばん下に畳まれていて見つからなかった。パワポの 1・3・8） */}
      {slots.length > 0 ? (
        <SeriesFields slots={slots} series={series} setSeries={(x) => (setSeries(x), setProblem(null))} />
      ) : (
        <p className="text-xs text-muted">{"{ }"} で囲んだところ（空欄）を置くと、毎回 AI に変えてもらう設定ができます。</p>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold">
          埋めた例<span className="ml-1.5 font-normal text-muted">任意</span>
        </span>
        <Textarea value={v.example} maxLength={MAX_FORMAT_EXAMPLE} rows={3} onChange={(e) => set("example", e.target.value)} placeholder="空欄を埋めた投稿の例。何を書けばいいかの手がかりになります" className="py-2 text-sm" />
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
      <FormatImageFields projectId={projectId} body={v.body} series={series} image={image} setImage={(x) => (setImage(x), setProblem(null))} />
      {problem && <p className="text-sm font-semibold text-danger">{problem}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || !v.name.trim() || !v.body.trim()}
          onClick={() => {
            const p = formatInputSchema.safeParse({ ...v, pillar: pillars.includes(v.pillar) ? v.pillar : "", hashtags: tags, series });
            if (!p.success) return setProblem(p.error.issues[0]?.message ?? "入力の形式が正しくありません。");
            // 画像の穴の決まりも画面で先に確かめる（正はサーバー）
            const img = cleanFormatImage(image, p.data.body, series);
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
  footnote = "本文の下に 1 行あけて付きます。投稿ごとに「2 送り先」で編集できます。",
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
          <span className="text-xs font-bold">案（選ぶと下の欄に入ります。編集してから保存します）</span>
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
    <section className={`flex flex-col gap-2.5 rounded-md border px-3 py-2.5 text-xs ${on ? "border-primary" : "border-line"}`} aria-label="毎回 AI に変えてもらう">
      <p className="text-[13px] font-bold">
        毎回 AI に変えてもらう<span className="ml-1.5 font-normal text-muted">任意・シリーズ</span>
      </p>
      <div className="flex flex-col gap-2.5">
        <p className="leading-[1.7] text-muted">
          {"{ }"} で囲んだところ（空欄）のうち、毎回ちがう言葉にしたいものを選びます。投稿をつくるときに、前の回と重ならない言葉を AI が考えます（例: 連想映画クイズの映画とキーワード）。こうしたフォーマットを「シリーズ」と呼びます。
        </p>
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
                <span>
                  「<span className="font-bold">{name}</span>」を毎回 AI に考えてもらう
                </span>
              </label>
              {ai && (
                // 指示は長くなるので 2 行以上の欄にし、書いた分だけ広げる（前は 1 行で切れた。パワポの 4）
                <Textarea
                  aria-label={`${name} の AI への指示`}
                  value={series.slots[name]}
                  maxLength={MAX_SERIES_INSTRUCTION}
                  rows={2}
                  onChange={(e) => setSeries({ ...series, slots: { ...series.slots, [name]: e.target.value } })}
                  placeholder="AI への指示（例: 答えの映画を連想できる言葉を 5 つ。・でつなぐ）"
                  className="min-h-[3.75rem] py-2 text-sm [field-sizing:content]"
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
                <Textarea
                  aria-label="答えの AI への指示"
                  value={series.answer.instruction}
                  maxLength={MAX_SERIES_INSTRUCTION}
                  rows={2}
                  onChange={(e) => setSeries({ ...series, answer: { ...series.answer!, instruction: e.target.value } })}
                  placeholder="AI への指示（例: だれでも知っている映画を 1 つ）"
                  className="min-h-[3.75rem] py-2 text-sm [field-sizing:content]"
                />
              </div>
            )}
            <span className="text-muted">答えは前の回と重ならないように使います。投稿には入りません。</span>
          </div>
        )}
      </div>
    </section>
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
  const label = format.series.answer?.name || "";
  // シリーズにしたばかりのときは開いて出し、すぐ読む（toggle を待たない）
  useEffect(() => {
    if (open) run(() => listFormatRounds(projectId, format.id));
    // 開いたときの 1 回だけ（key で作り直される）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const answerName = format.series.answer?.name || DEFAULT_ANSWER_NAME;
  return (
    <DisclosureBox
      label="シリーズのこれまでの投稿を表示"
      count={rounds ? `${rounds.length} / ${MAX_ROUNDS}` : undefined}
      className="text-xs"
      open={open || undefined}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && rounds === null && !pending) run(() => listFormatRounds(projectId, format.id));
      }}
    >
      <div className="flex flex-col gap-2">
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
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => deleteFormatRound(projectId, format.id, r.id))}>
                  消す
                </Button>
              </li>
            ))}
          </ul>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-bold">これまでの回を貼る</span>
          <span className="text-muted">
            yabumi の外で出した回{label ? `の${label}` : ""}を、1 行に 1 つ（1 回に {MAX_PASTE_ROUNDS} 行まで）。次の回の案で重ならないように使います。
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
    </DisclosureBox>
  );
}
