"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { AiThinking } from "@/components/ui/ai-thinking";
import { Button, NotReadyButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/chip";
import { draftFormatRound } from "@/lib/ai/post-format-actions";
import type { RoundProposal } from "@/lib/ai/format-round-ai";
import { ErrorBanner } from "@/components/ui/feedback";
import { HelpTip } from "@/components/ui/help";
import { Input, Textarea } from "@/components/ui/field";
import { addFormatRound, listPostFormats } from "@/lib/post-formats/actions";
import { DEFAULT_ANSWER_NAME, MAX_ROUND_ANSWER, MAX_ROUND_WISH, ROUND_PROPOSALS, SERIES_DAILY_RUNS, imageOnlySlots, isSeries, roundSlotNames, type FormatSeries } from "@/lib/post-formats/series";
import { MAX_SLOT_VALUE, fillFormat, unfilledSlots, formatSlots, hasFormatHashtags, type FormatHashtags, type PostFormat } from "@/lib/post-formats/schema";
import { FormatTagsLine } from "@/components/formats/format-manager";
import { DisclosureBox } from "@/components/ui/disclosure";

// 投稿のフォーマットを選んだ状態（整えるに渡す。docs/design/post-formats.md の 4）
// answer: シリーズのこの回の答え（本文には出ない。書きかけの控えに乗せる）
export type FormatUse = { format: PostFormat; values: Record<string, string>; answer?: string };

// 投稿をつくるの「フォーマットから」（docs/design/post-formats.md の 4。docs/architecture.md の 4.56）。
// 登録したフォーマットのカード、選んだフォーマットの穴の欄、「本文に入れる」（AI を使わない）。もう一度押すと選ぶのをやめる。
// フォーマットを作る・直すのは別の画面 /projects/[id]/formats（2026-11-18 オーナーの了承。前はこの下に畳んだ「フォーマットを管理」）
export function PostFormatPicker({
  projectId,
  bodyHasText,
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
  // fromAi: AI の次の回の案を使って入れた（「この本文は」を「AI の文をもとにした」にする。パワポの 13）
  // hashtags: フォーマットの毎回付けるタグ（SNS ごとのタグの欄に入れる。4.59）
  onInsert: (text: string, how: "replace" | "append", hashtags: FormatHashtags, fromAi: boolean) => void;
  onUseChange?: (use: FormatUse | null) => void;
  // 開いたときに選んでおくフォーマット（下書きから再開したとき。消したフォーマットなら「なし」）。
  // 書きかけの控えから戻したときは、穴の言葉と答えも入れて開く（PMO2 の 3 回目の 03）
  initialFormatId?: string | null;
  initialValues?: { values: Record<string, string>; answer: string };
  // シリーズの記録を付けた（docs/design/format-series.md の 2。画面が、保存で投稿に結びつけ、リセットで消す）
  onRoundAdded?: (id: string) => void;
}) {
  const [formats, setFormats] = useState<PostFormat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [how, setHow] = useState<"replace" | "append">("append");
  const [inserted, setInserted] = useState(false);
  // シリーズ: この回の答え（本文には出ない）と、AI の案を使ったか
  const [answer, setAnswer] = useState("");
  const [roundSource, setRoundSource] = useState<"ai" | "hand">("hand");
  const [roundError, setRoundError] = useState<string | null>(null);

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
          const slotNames = roundSlotNames(first.body, first.series);
          const v = Object.fromEntries(Object.entries(initialValues?.values ?? {}).filter(([k]) => slotNames.includes(k)));
          const a = first.series.answer || isSeries(first.series) ? (initialValues?.answer ?? "") : "";
          setSelectedId(first.id);
          setValues(v);
          setAnswer(a);
          onUseChange?.({ format: first, values: v, answer: a });
        }
      }
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

  // 本文に入れる。シリーズなら、この回を記録する（次の回の案で重ならないように）。同じ中身をもう一度入れたときは記録を重ねない
  const recorded = useRef<Set<string>>(new Set());
  function insert(f: PostFormat, v: Record<string, string>, a: string, source: "ai" | "hand") {
    onInsert(fillFormat(f.body, v), how, f.hashtags, source === "ai");
    setInserted(true);
    // 本文が空のところに入れたら、次に入れ直すときは置きかえる（穴を直して入れ直すと、同じ文が 2 つ並ばないように）
    if (!bodyHasText) setHow("replace");
    if (!isSeries(f.series)) return;
    const key = JSON.stringify([f.id, a, v]);
    if (recorded.current.has(key)) return;
    recorded.current.add(key);
    setRoundError(null);
    void addFormatRound(projectId, f.id, { answer: a, values: v, source }).then((r) => {
      if (r.error) {
        recorded.current.delete(key);
        setRoundError(`本文には入れました。ただ、このフォーマットで出した投稿の一覧に残せませんでした。${r.error}`);
      } else if (r.id) onRoundAdded?.(r.id);
    });
  }

  function setValue(slot: string, v: string) {
    const next = { ...values, [slot]: v };
    setValues(next);
    setInserted(false);
    if (selected) onUseChange?.({ format: selected, values: next, answer });
  }

  const formatsHref = `/projects/${projectId}/formats`;
  if (formats === null) {
    return (
      <section aria-label="フォーマットから" aria-busy={!error || undefined} className="flex min-w-0 flex-col gap-2">
        <p className="text-xs text-faint">フォーマットを読み込んでいます…</p>
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </section>
    );
  }
  const slots = selected ? formatSlots(selected.body) : [];
  // 画像だけで使う空欄（本文には入らない。画像をつくるときに使う。2026-11-20）
  const imageOnly = selected ? imageOnlySlots(selected.body, selected.series) : [];
  // 本文に入れたとき、まだ埋めていない穴（【穴の名前】のまま本文に入る）
  const unfilled = selected ? unfilledSlots(selected.body, values) : [];

  return (
    <section aria-label="フォーマットから" className="flex min-w-0 flex-col gap-2.5 border-t border-line pt-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 text-[14px] text-muted">
          いつも使うひな形を選んで、空欄を埋めます
          {formats?.some((f) => isSeries(f.series)) && <HelpTip label="シリーズとは">「シリーズ」の札が付いたフォーマットは、空欄の言葉を毎回 AI が考えます。前の投稿と重ならないので、クイズのように続けて出せます。</HelpTip>}
        </p>
        {/* 書きかけは控え（tab-drafts）に残るので、戻ると続きから書ける */}
        <Link href={formatsHref} className="text-[14px] font-bold text-fg underline">
          フォーマットを作る・編集 →
        </Link>
      </div>
      {formats.length === 0 ? (
        <p className="flex flex-wrap gap-x-3 text-[14px] text-muted">
          まだありません。
          <Link href={formatsHref} className="font-bold text-fg underline">
            フォーマットを作る →
          </Link>
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 max-sm:grid-cols-1" role="radiogroup" aria-label="フォーマット">
          {formats.map((f) => {
            const on = selectedId === f.id;
            const fSlots = formatSlots(f.body);
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => select(on ? null : f)}
                className={`flex flex-col items-start gap-0.5 rounded-md bg-surface text-left hover:bg-subtle ${on ? "border-2 border-primary px-[11px] py-[9px]" : "border border-border px-3 py-2.5"}`}
              >
                <span className="flex flex-wrap items-center gap-1.5 text-[15px] font-bold">
                  {f.name}
                  {isSeries(f.series) && <Badge>シリーズ</Badge>}
                </span>
                <span className="line-clamp-2 text-xs text-muted">
                  {isSeries(f.series) ? "AI に次の投稿の案を出してもらえます" : f.purpose || (fSlots.length ? fSlots.join("・") : "空欄なし")}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="flex flex-col gap-2.5 rounded-md bg-subtle px-4 py-3 max-sm:px-3">
          {selected.purpose && <p className="text-xs text-muted">{selected.purpose}</p>}
          {hasFormatHashtags(selected.hashtags) && <FormatTagsLine h={selected.hashtags} className="text-xs text-muted" />}
          {selected.example && (
            <DisclosureBox label="できあがりの例を表示" className="text-xs" onSubtle>
              <p className="rounded-md bg-surface2 px-3 py-2 text-[13px] leading-[1.7] whitespace-pre-wrap">{selected.example}</p>
            </DisclosureBox>
          )}
          {!isSeries(selected.series) && formatSlots(selected.body).length > 0 && (
            // AI に穴を埋めさせる設定がどこにあるかわからなかった（パワポの 1・8）
            <p className="text-xs text-muted">
              空欄の言葉を毎回 AI に考えてもらうには →{" "}
              <Link href={formatsHref} className="font-bold text-fg underline">
                「フォーマットの設定」
              </Link>
            </p>
          )}
          {isSeries(selected.series) && (
            <SeriesNextRound
              key={selected.id}
              projectId={projectId}
              formatId={selected.id}
              series={selected.series}
              aiEnabled={aiEnabled}
              onPick={(p) => {
                // 「これを使う」で本文まで入れる（前は穴の欄に入るだけで、もう一度「本文に入れる」を押す必要があった。パワポの 11）。
                // 穴の欄にも入れるので、直してから「本文に入れる」で入れ直せる
                const next = { ...values, ...p.values };
                setValues(next);
                setAnswer(p.answer);
                setRoundSource("ai");
                onUseChange?.({ format: selected, values: next, answer: p.answer });
                insert(selected, next, p.answer, "ai");
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
          {slots.length + imageOnly.length > 0 && (
            // 穴の欄は横いっぱいにし、長い言葉は折り返して全部見えるようにする（前は 2 列の 1 行の欄で、「キーワード5つ」の言葉が途中で切れた。通しテスト 02）。
            // 改行は入れない（Enter では改行しない。言い換えの確定の Enter はそのまま）
            <div className="flex flex-col gap-2">
              {[...slots, ...imageOnly].map((s) => (
                <label key={s} className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs font-bold">
                    {s}
                    {imageOnly.includes(s) ? (
                      <span className="ml-1.5 font-normal text-muted">画像だけで使う・本文には入りません</span>
                    ) : (
                      s in selected.series.slots && <span className="ml-1.5 font-normal text-muted">AI が埋める空欄・編集できます</span>
                    )}
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
              onClick={() => insert(selected, values, answer, roundSource)}
            >
              {inserted ? "本文に入れ直す" : "本文に入れる"}
            </Button>
            {bodyHasText && (
              <span role="radiogroup" aria-label="いまの本文" className="flex items-center gap-2 text-xs text-muted">
                {(["append", "replace"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1">
                    <input type="radio" name="format-insert" checked={how === k} onChange={() => setHow(k)} className="accent-[var(--primary)]" />
                    {k === "append" ? "いまの本文の下に追加" : "いまの本文を置きかえる"}
                  </label>
                ))}
              </span>
            )}
          </div>
          {roundError && <p className="text-xs font-semibold text-danger">{roundError}</p>}
          {inserted && (
            <p className="text-xs font-semibold text-success">
              {/* 全部埋めたときは【】の案内を出さない（前は埋めても「【】で残っています」と出た。通しテスト 02） */}
              {unfilled.length > 0 ? `本文に入れました。埋めなかった ${unfilled.join("・")} は、【】のまま残っています。書き換えてください。` : "本文に入れました。"}
              {hasFormatHashtags(selected.hashtags) && "タグは本文の下に付き、「2 送り先」で SNS ごとに編集できます。"}
            </p>
          )}
        </div>
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}
    </section>
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
  // 案が出たら、案のところまで動かす（前は画面の下に出て気づきにくかった。パワポの 10）
  const proposalsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (proposals && !pending) proposalsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [proposals, pending]);
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
        AI に次の投稿の案を出してもらう
      </NotReadyButton>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={ask}>
          {pending ? "考えています…" : failedOnce ? "もう一度出してもらう" : proposals ? "ほかの案を出してもらう" : "AI に次の投稿の案を出してもらう"}
        </Button>
        <span className="text-xs text-muted">前の投稿と重ならない案を 3 つ出します。1 回 5 円ほどで、1 日 {SERIES_DAILY_RUNS} 回まで使えます。</span>
      </div>
      <Input aria-label="次の投稿の案への希望" value={wish} maxLength={MAX_ROUND_WISH} onChange={(e) => setWish(e.target.value)} placeholder="希望（任意。例: 90 年代の映画で）" className="py-2 text-sm" />
      {pending && <AiThinking kind="round" note="10〜20 秒ほどかかります" />}
      {error &&
        (empty ? (
          // 文の後ろに「?」を続けて置く（前は flex で、PC で「?」だけ 3 行目に回った）。朱は先頭の印だけ（朱は印に使う決まり）
          <p className="text-[13px] leading-[1.7] font-semibold text-danger">
            <span aria-hidden className="mr-1 text-signal">
              ●
            </span>
            {error}{" "}
            <HelpTip label="案が出なかったわけ">
              AI の案が、どれも前の投稿と重なっていたか、空欄の決まりに合いませんでした。なので、案を除きました。AI はもう使ったので、今日の {SERIES_DAILY_RUNS} 回のうち 1 回に数えています。
            </HelpTip>
          </p>
        ) : (
          <ErrorBanner>{error}</ErrorBanner>
        ))}
      {proposals && !pending && (
        <div ref={proposalsRef} className="flex scroll-mt-24 flex-col gap-2">
          <p className="text-xs font-semibold text-fg">
            <span aria-hidden className="mr-1 text-signal">
              ●
            </span>
            AI は作品やものごとの中身を間違えることがあります。出す前に確認してください。
          </p>
          {!failedOnce && dropped > 0 && proposals.length < ROUND_PROPOSALS && (
            <p className="text-xs leading-[1.7] text-muted">
              前の投稿と重なる案を除いたので、案は {proposals.length} つです。{left !== null ? `今日はあと ${left} 回使えます。` : ""}{" "}
              <HelpTip label="案が少ないわけ">前の投稿と重なる案や、空欄の決まりに合わない案を除きました。「ほかの案を出してもらう」も、1 回に数えます。</HelpTip>
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
                    <span className="font-bold text-fg">確認してほしいところ</span>
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
