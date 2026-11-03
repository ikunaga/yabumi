"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { AiThinking } from "@/components/ui/ai-thinking";
import { Button, NotReadyButton } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { HelpTip } from "@/components/ui/help";
import { chipClass } from "@/components/ui/chip";
import type { TidyDraftResponse } from "@/app/api/ai/tidy-draft/route";
import { adoptTidyOption, tidyMainSns, type TidyOption } from "@/lib/ai/tidy-draft-apply";
import {
  DEFAULT_DIRECTION,
  directionSummary,
  isDefaultDirection,
  MAX_DIRECTION_NOTE,
  parseDirection,
  TIDY_AIMS,
  TIDY_EMOJIS,
  TIDY_LENGTHS,
  TIDY_TONES,
  type TidyDirection,
} from "@/lib/ai/tidy-direction";
import { isOnline } from "@/lib/client-errors";
import { displayLength, isManualSns, SNS, type SnsKey } from "@/lib/sns";

type Composer = { body: string; overrides: Partial<Record<SnsKey, string>> };

type Props = {
  projectId: string;
  aiEnabled: boolean;
  // いまの本文と SNS ごとの文面
  current: Composer;
  // 整える SNS（送り先に選んだもの）
  sns: SnsKey[];
  // 本文と SNS ごとの文面を入れ替える。edit: 案を使ったときに、SNS ごとの文面に入れた SNS（PC ではそのタブを開いて見せる）
  onReplace: (next: Composer, edit?: SnsKey) => void;
  // 案を使ったあとの 1 行から、本文・SNS ごとの文面の欄へ行く（押した人だけ）
  onShowBody: () => void;
  onEditOverride: (sns: SnsKey) => void;
  // 案を使った知らせを出しているか（出している間は、SNS ごとの文面の 1 行をこちらにまとめる）
  onAdoptedChange: (adopted: boolean) => void;
};

// 待つ時間の目安（画面に出す）。effort medium で、案 2〜3 個 × SNS ごとの文面を書く（docs/architecture.md の 4.34）
export const TIDY_WAIT = "20〜40 秒ほど";

// AI で投稿に整える（docs/architecture.md の 4.34）: 声で入れた話し言葉などを、言いたいことを 1 つに絞って SNS ごとの字数に収めた案にする。
// 案はカードの中でそのまま直せ、選ぶと本文と SNS ごとの文面に入る（入れたあとも直せる）。「元に戻す」で整える前の文に戻せる
export function TidyDraftPanel({ projectId, aiEnabled, current, sns, onReplace, onShowBody, onEditOverride, onAdoptedChange }: Props) {
  const [options, setOptions] = useState<TidyOption[] | null>(null);
  // 整え方。このプロジェクトで前に選んだものを、この端末に覚えておいて次も同じから始める（サーバーには保存しない）
  const storageKey = `yabumi:tidy-direction:${projectId}`;
  const stored = useSyncExternalStore(noopSubscribe, () => readStored(storageKey), () => null);
  const [picked, setPicked] = useState<TidyDirection | null>(null);
  const direction = picked ?? (stored ? parseDirection(safeJson(stored)) : DEFAULT_DIRECTION);
  const [directionOpen, setDirectionOpen] = useState(false);
  const summary = directionSummary(direction);
  // 整える前の文（案を使ったときに覚え、「元に戻す」で戻す）
  const [original, setOriginal] = useState<Composer | null>(null);
  const [adopted, setAdopted] = useState<{ index: number; main: SnsKey | null; split: SnsKey[] } | null>(null);
  // 案を使ったら案の欄を閉じ、知らせの 1 行だけにする（「ほかの案を見る」で開き直す）
  const [showOptions, setShowOptions] = useState(true);
  const notice = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // 待っている間（始めた時刻）。やめるときは abort で待つのをやめる
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const waiting = startedAt !== null;
  // 案を使ったあとに整え直すときは、整える前の文から
  const source = original?.body ?? current.body;
  const hasText = source.trim() !== "";
  // note・Substack（長い記事）は整えない
  const hasSns = sns.some((s) => !isManualSns(s));

  // 画面を離れたら、待つのをやめる
  useEffect(() => () => abort.current?.abort(), []);

  async function run() {
    setError(null);
    if (!isOnline()) {
      setError("インターネットにつながっていないようです。つながってから、もう一度押してください。");
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setStartedAt(Date.now());
    try {
      const res = await fetch("/api/ai/tidy-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, text: source, sns, direction }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as TidyDraftResponse;
      if (body.error || !body.options) {
        setError(body.error ?? "うまくいきませんでした。時間をおいてもう一度お試しください。");
        return;
      }
      setOptions(body.options);
      setAdopted(null);
      setShowOptions(true);
      onAdoptedChange(false);
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error("[tidy-draft]", e);
      setError("AI とのやりとりがうまくいきませんでした。通信をたしかめて、もう一度お試しください。");
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setStartedAt(null);
      }
    }
  }

  function chooseDirection(next: TidyDirection) {
    setPicked(next);
    try {
      if (isDefaultDirection(next)) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // 覚えられない端末（プライベートの窓など）では、この画面の間だけ
    }
  }

  // やめる（AI は最後まで動くので、費用はかかり、上限にも数える）
  function cancel() {
    abort.current?.abort();
    abort.current = null;
    setStartedAt(null);
  }

  function adopt(i: number) {
    const option = options![i];
    const base = original ?? current;
    if (!original) setOriginal(current);
    const next = adoptTidyOption(option, base);
    const split = option.drafts.map((d) => d.sns).filter((s) => next.overrides[s] !== undefined);
    // 上（本文）へは飛ばさない。案の欄を閉じて知らせの 1 行のあたりに留め、次の手順（画像の欄）がすぐ下に見えるようにする
    flushSync(() => {
      onReplace(next, split[0]);
      onAdoptedChange(true);
      setAdopted({ index: i, main: tidyMainSns(option), split });
      setShowOptions(false);
    });
    const el = notice.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // 押したボタンは消えるので、知らせにカーソルを移す
    el.focus({ preventScroll: true });
  }

  function restore() {
    if (!original) return;
    onReplace(original);
    onAdoptedChange(false);
    setOriginal(null);
    setAdopted(null);
    setShowOptions(true);
  }

  function editDraft(i: number, sns: SnsKey, text: string) {
    setOptions((prev) => prev && prev.map((o, n) => (n === i ? { ...o, drafts: o.drafts.map((d) => (d.sns === sns ? { ...d, text } : d)) } : o)));
  }

  const showSns = (options?.[0]?.drafts.length ?? 0) > 1;
  const adoptedOption = adopted ? options?.[adopted.index] : undefined;
  // SNS ごとの文面に入れた SNS のうち、いまも SNS ごとの文面のもの（「共通の文面に戻す」をしたら出さない）
  const split = adopted ? adopted.split.filter((s) => current.overrides[s] !== undefined) : [];
  const collapsed = !waiting && adoptedOption !== undefined && !showOptions;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="tidy-heading">
      <h2 id="tidy-heading" className="sr-only">
        AI で投稿に整える
      </h2>
      {/* 案を使って閉じている間は、知らせの 1 行（もう一度整えるもそこ）だけ */}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${collapsed ? "hidden" : ""}`}>
        {aiEnabled ? (
          <Button type="button" variant="secondary" size="sm" disabled={waiting || !hasText || !hasSns} aria-busy={waiting || undefined} onClick={run}>
            {waiting ? "整えています…" : options ? "もう一度整える" : "AI で投稿に整える"}
          </Button>
        ) : (
          <NotReadyButton variant="secondary" size="sm">
            AI で投稿に整える
          </NotReadyButton>
        )}
        {aiEnabled && (
          <button
            type="button"
            aria-expanded={directionOpen}
            aria-controls="tidy-direction"
            onClick={() => setDirectionOpen((o) => !o)}
            className="text-left text-[13px] font-semibold text-fg underline-offset-2 hover:underline"
          >
            {summary ? `整え方: ${summary}` : "整え方を選ぶ"}
            <span aria-hidden className={`ml-1 inline-block text-[10px] text-muted transition-transform ${directionOpen ? "rotate-180" : ""}`}>
              ▼
            </span>
          </button>
        )}
        <span className="text-xs text-muted">{!hasText ? "本文を話すか書くと押せます" : !hasSns ? "送り先の SNS（note・Substack 以外）を選ぶと押せます" : "1 回 5〜15 円ほど"}</span>
        <HelpTip label="AI で投稿に整える">
          話した言葉や思いつくままに書いた文から、言いたいことを 1 つに絞り、選んだ SNS ごとの字数に収めた案を 2〜3 個出します。最初の 1 行で引きつける・問いかけで終えるなど、形の違う案から選べます。案はその場で直してから使えます。あなたが言っていないこと（数字・できごと・感想）は足しません。口調とやらないこと、ハッシュタグはアカウント設計に合わせます（口調・長さ・ねらい・絵文字は「整え方を選ぶ」で変えられます。やらないことはどの整え方でも守ります）。AI はいまはやっている言葉や話題を知らない（その時々のデータを見ていない）ので、はやりには合わせません。1 回 5〜15 円ほどかかります。
        </HelpTip>
      </div>

      {aiEnabled && directionOpen && !collapsed && (
        <DirectionPicker value={direction} onChange={chooseDirection} onClose={() => setDirectionOpen(false)} />
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {waiting && <TidyWaiting startedAt={startedAt} cards={Math.min(3, Math.max(2, options?.length ?? 3))} onCancel={cancel} />}

      {!waiting && adopted && adoptedOption && (
        <div
          ref={notice}
          tabIndex={-1}
          role="status"
          className="flex scroll-mt-20 scroll-mb-24 flex-col gap-1 max-sm:scroll-mt-3 rounded-md bg-primary-soft px-3 py-2 text-sm text-fg outline-none focus-visible:shadow-[0_0_0_2px_var(--primary)]"
        >
          <p>
            「{adoptedOption.label}」の案を使いました。本文に入れました（
            <button type="button" className={linkClass} onClick={onShowBody}>
              本文を見る
            </button>
            ）
          </p>
          {split.length > 0 && adopted.main && (
            <p className="text-[13px] text-muted">
              {split.map((s) => SNS[s].label).join("・")} には SNS ごとの文面を入れました（{SNS[adopted.main].label} と字数が違うため）。
              {split.map((s) => (
                <button key={s} type="button" className={`ml-2 ${linkClass}`} onClick={() => onEditOverride(s)}>
                  {SNS[s].label} 用の文面を直す
                </button>
              ))}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {!showOptions && (
              <button type="button" className={linkClass} onClick={() => setShowOptions(true)}>
                ほかの案を見る
              </button>
            )}
            <button type="button" className={linkClass} onClick={restore}>
              元に戻す
            </button>
            {collapsed && aiEnabled && (
              <button type="button" className={linkClass} disabled={!hasText || !hasSns} onClick={run}>
                もう一度整える<span className="ml-1 text-xs font-normal text-muted">1 回 5〜15 円ほど</span>
              </button>
            )}
          </p>
        </div>
      )}

      {!waiting && options && showOptions && (
        <ul className="flex flex-col gap-3">
          {options.map((o, i) => (
            <li key={i} className={`flex flex-col gap-2 rounded-lg border bg-surface p-4 ${adopted?.index === i ? "border-primary" : "border-line"}`}>
              <div className="flex items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-bold text-fg">{o.label}</span>
                  {o.why && <span className="text-[13px] leading-[1.7] text-muted">{o.why}</span>}
                </div>
                {adopted?.index === i ? (
                  <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary">使っています</span>
                ) : (
                  <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => adopt(i)}>
                    この案を使う
                  </Button>
                )}
              </div>
              {o.drafts.map((d) => (
                <DraftEditor
                  key={d.sns}
                  id={`tidy-${i}-${d.sns}`}
                  sns={d.sns}
                  text={d.text}
                  showSns={showSns}
                  // 使っている案は、本文と SNS ごとの文面の側で直す（直す場所を二重にしない）
                  readOnly={adopted?.index === i}
                  onChange={(text) => editDraft(i, d.sns, text)}
                />
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const linkClass = "font-semibold text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-faint";

const noopSubscribe = () => () => {};

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 整え方を選ぶ欄。口調・長さ・ねらい・絵文字は選んだものの説明を 1 行で、ほかに一言は 100 字まで
function DirectionPicker({ value, onChange, onClose }: { value: TidyDirection; onChange: (next: TidyDirection) => void; onClose: () => void }) {
  const noteId = useId();
  return (
    <div id="tidy-direction" className="flex flex-col gap-3.5 rounded-lg border border-line bg-surface2 px-4 py-3.5">
      <ChoiceRow label="口調" list={TIDY_TONES} value={value.tone} onChange={(tone) => onChange({ ...value, tone })} />
      <ChoiceRow label="長さ" list={TIDY_LENGTHS} value={value.length} onChange={(length) => onChange({ ...value, length })} />
      <ChoiceRow label="ねらい" list={TIDY_AIMS} value={value.aim} onChange={(aim) => onChange({ ...value, aim })} />
      <ChoiceRow label="絵文字" list={TIDY_EMOJIS} value={value.emoji} onChange={(emoji) => onChange({ ...value, emoji })} />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={noteId} className="text-[13px] font-bold">
            ほかに一言<span className="ml-1 font-normal text-muted">（なくてもよい）</span>
          </label>
          <span className="num text-xs text-faint">
            {[...value.note].length}/{MAX_DIRECTION_NOTE}
          </span>
        </div>
        <input
          id={noteId}
          value={value.note}
          maxLength={MAX_DIRECTION_NOTE}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          placeholder="例: 季節感を出して／専門用語を使わないで"
          className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
        />
      </div>
      <p className="text-xs leading-[1.7] text-muted">
        どの整え方でも、書いていないことは足さず、設計の「やらないこと」は守ります。選んだものはこの端末に覚え、次もここから始まります。
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        {!isDefaultDirection(value) && (
          <button type="button" onClick={() => onChange(DEFAULT_DIRECTION)} className="font-semibold text-muted underline-offset-2 hover:text-fg hover:underline">
            設計どおりに戻す
          </button>
        )}
        <button type="button" onClick={onClose} className="font-semibold text-fg underline-offset-2 hover:underline">
          閉じる
        </button>
      </div>
    </div>
  );
}

function ChoiceRow<K extends string>({
  label,
  list,
  value,
  onChange,
}: {
  label: string;
  list: readonly { key: K; label: string; hint: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const id = useId();
  const current = list.find((c) => c.key === value);
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-[13px] font-bold">
        {label}
      </span>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {list.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={c.key === value}
            onClick={() => onChange(c.key)}
            className={chipClass({ on: c.key === value })}
          >
            {c.label}
          </button>
        ))}
      </div>
      {current && <span className="text-xs text-muted">{current.hint}</span>}
    </div>
  );
}

// 案の文面。使う前はその場で直せ、直すたびに字数を数える
function DraftEditor({
  id,
  sns,
  text,
  showSns,
  readOnly,
  onChange,
}: {
  id: string;
  sns: SnsKey;
  text: string;
  showSns: boolean;
  readOnly: boolean;
  onChange: (text: string) => void;
}) {
  const max = SNS[sns].maxLength;
  const length = displayLength(sns, text);
  const over = max !== null && length > max;
  const label = SNS[sns].label;
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-muted">
          {showSns ? label : "文面"}
          {readOnly ? "（本文と SNS ごとの文面に入れました）" : "（ここで直してから使えます）"}
        </label>
        <span className={`num shrink-0 text-xs ${over ? "font-bold text-danger" : "text-faint"}`}>
          {length}
          {max !== null && `/${max}`}
        </span>
      </div>
      {readOnly ? (
        <p id={id} className="text-[15px] leading-[1.75] whitespace-pre-wrap text-fg">
          {text}
        </p>
      ) : (
        <textarea
          id={id}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.min(10, Math.max(3, text.split("\n").length + Math.ceil(text.length / 40)))}
          className="w-full resize-y rounded-md border border-input bg-surface px-3 py-2 text-[15px] leading-[1.75] text-fg outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
        />
      )}
      {over && (
        <p className="text-[13px] font-semibold text-danger">
          {label} の上限を {length - max!} 字超えています。{readOnly ? "本文か SNS ごとの文面で縮めてください。" : "ここで縮めてから使えます。"}
        </p>
      )}
    </div>
  );
}

// 案を待っている間。案のカードの形の骨組みと、動く印・段階の文・経った秒数（ui/ai-thinking）、待つ時間の目安、やめる
function TidyWaiting({ startedAt, cards, onCancel }: { startedAt: number | null; cards: number; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 出たら見える位置に（スマホで、ボタンの下が画面の外にあるとき）
    box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  return (
    <div ref={box} className="flex flex-col gap-3">
      <AiThinking kind="tidy" startedAt={startedAt} note={`${TIDY_WAIT}かかります。待っている間も本文は書けます`} className="rounded-lg border border-primary bg-primary-soft px-4 py-3.5">
        <button type="button" onClick={onCancel} className="font-semibold text-fg underline-offset-2 hover:underline">
          やめる
        </button>
      </AiThinking>
      <ul aria-hidden className="flex flex-col gap-3">
        {Array.from({ length: cards }, (_, i) => (
          <li key={i} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-1 flex-col gap-2">
                <div className="h-4 w-32 rounded-md bg-subtle" />
                <div className="h-3 w-3/4 rounded-md bg-subtle" />
              </div>
              <div className="h-8 w-24 rounded-md bg-subtle" />
            </div>
            <div className="h-3 w-full rounded-md bg-subtle" />
            <div className="h-3 w-5/6 rounded-md bg-subtle" />
          </li>
        ))}
      </ul>
    </div>
  );
}
