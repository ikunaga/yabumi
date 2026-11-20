"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ErrorBanner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { HelpTip } from "@/components/ui/help";
import { SnsTag } from "@/components/ui/marks";
import { makeAutoSample, makeAutoSampleImage } from "@/lib/auto-post/actions";
import { INSTRUCTION_PRESETS, RUN_REASON_TEXT } from "@/lib/auto-post/labels";
import { AUTO_INSTRUCTION_MAX, AUTO_INSTRUCTIONS_MAX, AUTO_SAMPLE_DAILY_RUNS } from "@/lib/auto-post/schema";
import type { AutoPlanInput, AutoSample } from "@/lib/auto-post/types";
import type { SnsKey } from "@/lib/sns";
import { withHashtags } from "@/lib/sns/hashtags";

// 見本の 1 回と、見本に指示を出して作り直す（docs/design/auto-sample-image.md の 1.。ウィザードの「確かめる」と回し方の画面で使う）。
// - 指示はチップで選ぶ（自分で書く欄もある）。「これからの回にも使う」を付けると、回し方の書き方の指示に足す（外すとその 1 回だけ）
// - 作り直しは同じ材料で（前の見本をサーバーに置いてあるので、その材料を使う）。1 回 約 10 円（auto-sample-image.md の 4.）
// - adopt（新しく作るときだけ）: 「この見本を最初の回にする」。見本を作ったあとに設定を変えたら、作り直すまで選べない

const SAMPLE_YEN = 10;

type Props = {
  projectId: string;
  // いまの設定（見本を作る材料。指示は instructions を使う）
  input: () => Omit<AutoPlanInput, "consent"> | null;
  instructions: string[];
  // 指示の一覧を変える。失敗したら画面に出す文を返す
  onInstructions: (next: string[]) => Promise<string | null>;
  // シリーズは型の文をそのまま使うので、指示は効かない
  series?: boolean;
  adopt?: { on: boolean; set: (on: boolean) => void };
  onSample?: (s: AutoSample | null) => void;
};

const settingsKey = (i: Omit<AutoPlanInput, "consent"> | null) =>
  i ? JSON.stringify({ kind: i.kind, materials: i.materials, targets: i.targets, xLink: i.xLink, instructions: i.instructions, image: i.image }) : "";
// 見本の画像の見込み（1 枚 約 5 円。AI が場面を考えるときは 約 7〜8 円。docs/design/auto-sample-image.md の 4.）
const IMAGE_YEN = "5〜8";

export function SampleCard(p: Props) {
  const [sample, setSampleState] = useState<AutoSample | null>(null);
  const [madeWith, setMadeWith] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [own, setOwn] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sampling, startSample] = useTransition();
  const [drawing, startDraw] = useTransition();

  const setSample = (s: AutoSample | null, key: string) => {
    setSampleState(s);
    setMadeWith(key);
    p.onSample?.(s);
    if (p.adopt) p.adopt.set(!!s?.sampleId && s.issues.length === 0 && Object.keys(s.texts).length > 0);
  };

  const make = (opts: { instructions?: string[]; oneTime?: string; same?: boolean } = {}) =>
    startSample(async () => {
      setError(null);
      const base = p.input();
      if (!base) return;
      const i = { ...base, instructions: opts.instructions ?? p.instructions };
      const r = await makeAutoSample(p.projectId, i, { ...(opts.oneTime ? { oneTime: opts.oneTime } : {}), ...(opts.same && sample?.sampleId ? { fromSampleId: sample.sampleId } : {}) });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSample(r.data, settingsKey(i));
      setPicked([]);
      setOwn("");
    });

  const chosen = [...picked, ...(own.trim() ? [own.trim()] : [])];
  const redo = async () => {
    setError(null);
    if (!chosen.length) return;
    if (remember) {
      const next = [...new Set([...p.instructions, ...chosen])];
      if (next.length > AUTO_INSTRUCTIONS_MAX) {
        setError(`これからの回に使う指示は ${AUTO_INSTRUCTIONS_MAX} 個までです。下の一覧から、いらないものを外してください。`);
        return;
      }
      const e = await p.onInstructions(next);
      if (e) {
        setError(e);
        return;
      }
      make({ instructions: next, same: true });
    } else {
      const oneTime = chosen.join("。");
      if ([...oneTime].length > AUTO_INSTRUCTION_MAX) {
        setError(`その 1 回だけの指示は、合わせて ${AUTO_INSTRUCTION_MAX} 字までです。`);
        return;
      }
      make({ oneTime, same: true });
    }
  };
  const remove = async (t: string) => {
    setError(null);
    const e = await p.onInstructions(p.instructions.filter((x) => x !== t));
    if (e) setError(e);
  };

  const wrote = !!sample && Object.keys(sample.texts).length > 0;
  const wantsImage = !!p.input()?.image;
  const draw = () =>
    startDraw(async () => {
      setError(null);
      if (!sample?.sampleId) return;
      const r = await makeAutoSampleImage(p.projectId, sample.sampleId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const next = { ...sample, image: r.data };
      setSampleState(next);
      p.onSample?.(next);
      if (p.adopt) p.adopt.set(next.issues.length === 0);
    });
  const stale = !!sample && madeWith !== settingsKey(p.input() ? { ...p.input()!, instructions: p.instructions } : null);
  // 画像を選んだ回し方は、見本の画像もつくってから（画像なしの見本は、実際の回と同じではないため）
  const canAdopt = !!p.adopt && wrote && !!sample?.sampleId && sample.issues.length === 0 && !stale && (!wantsImage || !!sample.image);

  return (
    <Card className="flex flex-col gap-4 px-6 py-5 max-sm:px-4 max-sm:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[18px] font-bold max-sm:text-[16px]">テストで 1 件つくる</h2>
            <HelpTip label="テストでつくることについて">
              AI を 1 回使います（約 {SAMPLE_YEN} 円。1 日 {AUTO_SAMPLE_DAILY_RUNS} 回まで）。つくった投稿は 1 日だけ預かり、1 回目として送らなければ消えます。
            </HelpTip>
          </div>
          <p className="text-sm text-muted">設定どおりに 1 件つくって見せます。SNS には送りません。</p>
        </div>
        <Button type="button" variant="secondary" disabled={sampling} onClick={() => make()}>
          {sampling ? "つくっています…" : sample ? "もう一度つくる" : "テストで 1 件つくる"}
        </Button>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {sample && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <p className="text-[15px] font-bold">テストでつくった投稿</p>
          <SampleView sample={sample} />
        </div>
      )}
      {wrote && wantsImage && !sample!.image && sample!.issues.length === 0 && sample!.sampleId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-line px-4 py-3">
          <p className="text-sm text-muted">画像は、押したときだけつくります（文を作り直しても、画像はつくり直しません）。</p>
          <Button type="button" variant="secondary" size="sm" disabled={drawing || sampling} onClick={draw}>
            {drawing ? "つくっています…" : `画像もつくる（約 ${IMAGE_YEN} 円）`}
          </Button>
        </div>
      )}
      {stale && <p className="text-sm text-muted">テストでつくったあとに設定を変えました。いまの設定で見るには、もう一度つくってください。</p>}

      {wrote && p.series && <p className="text-sm text-muted">シリーズは、フォーマットの型の文で書きます。書き方を変えるときは、フォーマットを編集してください。</p>}

      {wrote && !p.series && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <p className="text-[15px] font-bold">変えたいところ</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="変えたいところ">
            {INSTRUCTION_PRESETS.map((t) => (
              <Chip key={t} on={picked.includes(t)} disabled={sampling} onClick={() => setPicked(picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t])}>
                {t}
              </Chip>
            ))}
          </div>
          <Field label="自分で書く" htmlFor="sample-own" optional hint={`${AUTO_INSTRUCTION_MAX} 字まで。例: 2 文で終える`}>
            <Input id="sample-own" maxLength={AUTO_INSTRUCTION_MAX} value={own} onChange={(e) => setOwn(e.target.value)} disabled={sampling} />
          </Field>
          <label className="flex items-start gap-2.5 text-[15px] leading-[1.7]">
            <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--primary)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>この指示を、これからの回にも使う</span>
          </label>
          <div className="flex justify-end max-sm:flex-col max-sm:items-stretch">
            <Button type="button" disabled={sampling || chosen.length === 0} onClick={() => void redo()}>
              {sampling ? "つくっています…" : `この指示で作り直す（約 ${SAMPLE_YEN} 円）`}
            </Button>
          </div>
        </div>
      )}

      {p.instructions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">これからの回に使う指示</p>
          <ul className="flex flex-wrap gap-2">
            {p.instructions.map((t) => (
              <li key={t} className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface pr-1 pl-3 text-[13px]">
                {t}
                <button type="button" aria-label={`「${t}」を外す`} disabled={sampling} onClick={() => void remove(t)} className="inline-flex size-6 items-center justify-center rounded-full text-muted hover:bg-subtle hover:text-fg">
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.adopt && wrote && (
        <label className={`flex items-start gap-2.5 text-[15px] leading-[1.7] ${canAdopt ? "" : "text-muted"}`}>
          <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--primary)]" disabled={!canAdopt} checked={canAdopt && p.adopt.on} onChange={(e) => p.adopt!.set(e.target.checked)} />
          <span>
            この投稿を 1 回目として送る
            <span className="block text-sm text-muted">
              {canAdopt
                ? "1 回目の確かめは要りません（X などの「確かめて送る」SNS は、送る前にいつもどおり確かめます）。"
                : sample?.issues.length
                  ? "送る前の確かめで引っかかった投稿は、1 回目として送れません。"
                  : wantsImage && !sample?.image && !stale
                    ? "画像もつくると選べます。"
                    : "いまの設定で作り直すと選べます。"}
            </span>
          </span>
        </label>
      )}
    </Card>
  );
}

// 見本の中身（SNS ごとの送る文そのまま）。書けなかったときは理由だけ
export function SampleView({ sample }: { sample: AutoSample }) {
  const entries = Object.entries(sample.texts) as [SnsKey, string][];
  const cannot = entries.length === 0;
  const reasons = cannot ? sample.issues.map((i) => i.detail || RUN_REASON_TEXT[i.kind]) : [];
  const issues = cannot ? [] : sample.issues;
  return (
    <div className="flex flex-col gap-3">
      {sample.materialLabel && <p className="text-sm text-muted">材料: {sample.materialLabel}</p>}
      {cannot && (
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-bold">この材料では書けませんでした。本番の回なら、この回は飛ばします。</p>
          {reasons.map((r, n) => (
            <p key={n} className="text-[14px] text-muted">
              {r}
            </p>
          ))}
        </div>
      )}
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md bg-signal-soft px-4 py-3 text-[14px]">
          {issues.map((i, n) => (
            <li key={n}>
              <span className="font-bold text-signal">● </span>
              {RUN_REASON_TEXT[i.kind]}
              {i.detail && <span className="text-muted">（{i.detail}）</span>}
            </li>
          ))}
        </ul>
      )}
      {entries.map(([s, text]) => (
        <div key={s} className="flex flex-col items-start gap-1.5 rounded-md border border-border px-4 py-3">
          <SnsTag sns={s} />
          <p className="text-[15px] leading-[1.8] whitespace-pre-wrap">{withHashtags(text, sample.tags?.[s] ?? [])}</p>
        </div>
      ))}
      {sample.image && (
        <figure className="flex flex-col gap-1.5">
          <div className="flex max-w-[360px] items-center justify-center overflow-hidden rounded-md border border-line bg-surface2">
            {/* eslint-disable-next-line @next/next/no-img-element -- 署名つきの URL は期限があり、next/image の最適化を通さない */}
            <img src={sample.image.url} alt={sample.image.alt || "テストでつくった投稿の画像"} className="h-auto w-full object-contain" />
          </div>
          <figcaption className="text-xs leading-[1.6] text-muted">AI で作った画像{sample.image.alt ? `（画像の説明: ${sample.image.alt}）` : ""}</figcaption>
        </figure>
      )}
    </div>
  );
}
