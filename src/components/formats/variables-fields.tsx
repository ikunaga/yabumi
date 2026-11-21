"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/chip";
import { Input, Textarea } from "@/components/ui/field";
import { Term } from "@/components/ui/term";
import { Choice } from "@/components/posts/maker-parts";
import {
  MAX_AI_VARS,
  MAX_FORMAT_VARS,
  MAX_SERIES_INSTRUCTION,
  aiVarOrder,
  aiVars,
  fixedBodySeries,
  handVars,
  okVarName,
  seriesProblem,
  varPlaces,
  type FormatSeries,
  type FormatVar,
  type VarTexts,
} from "@/lib/post-formats/series";

// フォーマットの編集の「変数」の欄（docs/design/format-series.md の 1。2026-11-21 オーナーが案を了承）。
// 変数ごとに、名前と入る場所の札・作り方・AI への指示・「前の投稿と重ならないようにする」。
// 札（本文・画像・どこにも出ない）は、本文と画像の設定に {名前} が書いてあるかを見て付ける（利用者は選ばない）
export function VariablesFields({ series, texts, setSeries }: { series: FormatSeries; texts: VarTexts; setSeries: (s: FormatSeries) => void }) {
  const [name, setName] = useState("");
  const [why, setWhy] = useState<string | null>(null);
  const vars = series.vars;
  const update = (n: string, patch: Partial<FormatVar>) => setSeries({ vars: vars.map((v) => (v.name === n ? { ...v, ...patch } : v)) });
  const aiFull = aiVars(series).length >= MAX_AI_VARS;
  function add() {
    const n = name.trim();
    const problem = !okVarName(n) ? "名前は 12 字までです。{ } は入れられません。" : vars.some((v) => v.name === n) ? "同じ名前の変数があります。" : null;
    setWhy(problem);
    if (problem) return;
    setSeries({ vars: [...vars, { name: n, mode: aiFull ? "hand" : "ai", instruction: "", unique: false }] });
    setName("");
  }
  const { order } = aiVarOrder(series);
  const hand = handVars(series);
  const problem = seriesProblem(series);
  return (
    <section className="flex flex-col gap-2.5 rounded-md border border-primary px-3 py-2.5 text-xs" aria-label="変数">
      <p className="text-[13px] font-bold">
        <Term k="variable">変数</Term>
      </p>
      <p className="leading-[1.7] text-muted">本文や絵の説明に {"{商品}"} のように書くと、そこに投稿ごとの言葉が入ります。書いた場所は、名前の横の札に出ます。</p>
      {vars.length === 0 && <p className="text-muted">まだありません。本文に {"{商品}"} のように書くか、下で追加してください。</p>}
      {vars.map((v) => {
        const places = varPlaces(v.name, texts);
        return (
          <div key={v.name} className="flex flex-col gap-2 rounded-md border border-line bg-bg px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-bold">{`{${v.name}}`}</span>
              {places.includes("body") && <Badge tone="info">本文</Badge>}
              {places.includes("image") && <Badge tone="success">画像</Badge>}
              {places.length === 0 && <Badge>投稿に出ない</Badge>}
              {/* 本文や画像に書いてある変数は、そこから {名前} を消すとなくなる（ここで消しても書いてあれば戻る） */}
              {places.length === 0 && (
                <button type="button" onClick={() => setSeries({ vars: vars.filter((o) => o.name !== v.name) })} className="ml-auto text-muted underline">
                  削除する
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Choice on={v.mode === "ai"} onClick={() => (v.mode !== "ai" && aiFull ? setWhy(`AI が考える変数は ${MAX_AI_VARS} 個までです。`) : update(v.name, { mode: "ai" }))}>
                毎回 AI が考える
              </Choice>
              <Choice on={v.mode === "hand"} onClick={() => update(v.name, { mode: "hand", instruction: "", unique: false })}>
                投稿をつくるときに自分で入れる
              </Choice>
            </div>
            {v.mode === "ai" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="font-bold">AI への指示</span>
                  <Textarea
                    value={v.instruction}
                    maxLength={MAX_SERIES_INSTRUCTION}
                    rows={2}
                    onChange={(e) => update(v.name, { instruction: e.target.value })}
                    placeholder={places.length === 0 ? "例: だれでも知っている映画を 1 つ" : "例: {映画}を連想できる言葉を 5 つ。「・」でつなぐ"}
                    className="min-h-[3.75rem] py-2 text-sm [field-sizing:content]"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={v.unique} onChange={(e) => update(v.name, { unique: e.target.checked })} className="accent-[var(--primary)]" />
                  <span>前の投稿と同じ言葉にならないようにする</span>
                </label>
              </>
            ) : (
              <span className="leading-[1.7] text-muted">投稿をつくるとき、この変数を入れる欄が出ます。自動投稿では、「自動投稿」の設定で入れ方を選びます。</span>
            )}
            {places.length === 0 && v.mode === "ai" && (
              <span className="leading-[1.7] text-muted">投稿には出ません。前の投稿と同じ言葉を選ばないための目印です。ほかの変数の指示にも使えます。</span>
            )}
          </div>
        );
      })}
      {vars.length >= MAX_FORMAT_VARS ? (
        <span className="text-muted">変数は {MAX_FORMAT_VARS} 個までです。</span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="追加する変数の名前"
            value={name}
            maxLength={12}
            onChange={(e) => (setName(e.target.value), setWhy(null))}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              add();
            }}
            placeholder="例: 映画"
            className="w-40 py-2 text-sm"
          />
          <Button type="button" size="sm" variant="secondary" onClick={add}>
            ＋ 変数を追加
          </Button>
        </div>
      )}
      {why && <span className="font-semibold text-danger">{why}</span>}
      {problem && <span className="font-semibold text-danger">{problem}</span>}
      {(order.length > 0 || hand.length > 0) && (
        <p className="border-t border-line pt-2 text-muted">
          {order.length > 0 && (
            <>
              AI は、<b className="text-fg">{order.join("、")}</b>の順に考えます。
            </>
          )}
          {hand.length > 0 && (
            <>
              自分で入れる変数は、<b className="text-fg">{hand.map((v) => v.name).join("・")}</b>です。
            </>
          )}
        </p>
      )}
      {/* 本文に AI の変数がないシリーズは、本文が毎回同じ（X に自動で送れない。2026-11-20 PM の指示） */}
      {fixedBodySeries(texts.body, series) && (
        <p className="font-semibold leading-[1.7] text-signal">● このフォーマットは、本文が毎回同じになります。X は同じ文を続けて送れないので、自動投稿では X を選べません。</p>
      )}
    </section>
  );
}

// 本文の下に並べる、押すと {名前} を入れるチップ
export function VarChips({ series, onInsert }: { series: FormatSeries; onInsert: (token: string) => void }) {
  if (!series.vars.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      押すと、その変数を本文に入れます
      {series.vars.map((v) => (
        <button
          key={v.name}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(`{${v.name}}`)}
          className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-fg hover:border-primary"
        >
          {`{${v.name}}`}
        </button>
      ))}
    </div>
  );
}

// textarea のカーソルの位置に差し込む（選んでいる文字は置きかえる）
export function insertAt(el: HTMLTextAreaElement | null, current: string, token: string): { next: string; caret: number } {
  const start = el?.selectionStart ?? current.length;
  const end = el?.selectionEnd ?? current.length;
  return { next: current.slice(0, start) + token + current.slice(end), caret: start + token.length };
}
