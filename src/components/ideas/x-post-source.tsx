"use client";

import { useState, type ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { Input, Textarea } from "@/components/ui/field";
import {
  MAX_X_POST_INTEREST,
  MAX_X_POST_TEXT,
  X_DEFAULT_MIN_FAVES,
  X_MIN_FAVES_OPTIONS,
  X_POST_INTEREST_CHOICES,
  X_POST_INTEREST_QUESTION,
  X_SEARCH_WORD_MAX_CHARS,
  cleanSearchWord,
  parseXPostUrl,
  xSearchUrl,
  type XMinFaves,
  type XPostPick,
} from "@/lib/ideas/x-post";

export type XPostValue = { url: string; text: string; interest: string };

type Props = {
  projectId: string;
  // アカウント設計から作った検索の言葉（src/lib/ideas/x-post.ts の xSearchWords）
  words: string[];
  value: XPostValue;
  onChange: (next: XPostValue) => void;
  // yabumi の中で探す（A 案、実装担当1 の x-buzz-search.tsx）を差し込む口。query はいま選んでいる言葉（演算子なし）
  renderSearch?: (ctx: { projectId: string; query: string; onPick: (p: XPostPick) => void }) => ReactNode;
};

// 「X で人気の投稿から」の中身（4.52）: 検索の言葉で X の人気の検索を開き、気になった投稿の URL と文を貼る。
// 探すのは X の画面で（費用 0）。投稿の中身は yabumi から読まない
export function XPostSource({ projectId, words: initialWords, value, onChange, renderSearch }: Props) {
  const [words, setWords] = useState<string[]>(() => (initialWords.length ? initialWords : [""]));
  const [minFaves, setMinFaves] = useState<XMinFaves>(X_DEFAULT_MIN_FAVES);
  // yabumi の中で探す（A 案）に渡す、いま選んでいる言葉
  const [active, setActive] = useState(0);
  const urlTouched = value.url.trim() !== "";
  const ref = parseXPostUrl(value.url);
  const set = (patch: Partial<XPostValue>) => onChange({ ...value, ...patch });

  // yabumi の中で探す（A 案）で選んだ投稿を、URL と文の欄に入れる
  function pick(p: XPostPick) {
    onChange({ url: p.url, text: p.text.slice(0, MAX_X_POST_TEXT), interest: value.interest });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[15px] leading-[1.7]">X で開いて、気になった投稿の URL を下に貼ってください</p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[15px] font-bold">
          検索の言葉<span className="text-[13px] font-normal text-faint">直してから開けます</span>
        </legend>
        <ul className="flex flex-col gap-2">
          {words.map((w, i) => {
            const word = cleanSearchWord(w);
            return (
              <li key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`検索の言葉 ${i + 1}`}
                  value={w}
                  maxLength={X_SEARCH_WORD_MAX_CHARS}
                  onFocus={() => setActive(i)}
                  onChange={(e) => setWords((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                  className="min-w-0 flex-1"
                />
                {word ? (
                  <a
                    href={xSearchUrl(word, minFaves)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setActive(i)}
                    className={buttonClass({ variant: "secondary", size: "md", className: "shrink-0 max-sm:px-3.5" })}
                  >
                    X で開く<span aria-hidden>↗</span>
                    <span className="sr-only">（新しいタブ）</span>
                  </a>
                ) : (
                  <span className={buttonClass({ variant: "secondary", size: "md", className: "shrink-0 opacity-40 max-sm:px-3.5" })} aria-disabled>
                    X で開く<span aria-hidden>↗</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted" role="group" aria-label="人気の目安（いいねの数）">
          <span>いいね</span>
          {X_MIN_FAVES_OPTIONS.map((n) => (
            <button key={n} type="button" aria-pressed={minFaves === n} onClick={() => setMinFaves(n)} className={chipClass({ on: minFaves === n })}>
              <span className="num">{n}</span> 以上
            </button>
          ))}
        </div>
      </fieldset>

      {renderSearch?.({ projectId, query: cleanSearchWord(words[active] ?? ""), onPick: pick })}

      <div className="flex flex-col gap-2">
        <label htmlFor="idea-x-url" className="text-[15px] font-bold">
          投稿の URL
        </label>
        <Input
          id="idea-x-url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value.url}
          maxLength={500}
          invalid={urlTouched && !ref}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="https://x.com/…/status/…"
        />
        {urlTouched && !ref && (
          <p id="idea-x-url-error" className="text-[13px] text-danger">
            X の投稿の URL（x.com/…/status/… の形）を貼ってください
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="idea-x-text" className="text-[15px] font-bold">
          気になったところ<span className="ml-1.5 text-[13px] font-normal text-faint">任意</span>
        </label>
        <Textarea
          id="idea-x-text"
          rows={4}
          maxLength={MAX_X_POST_TEXT}
          value={value.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="投稿の文を写して貼ってください（気になった部分だけでも）"
        />
        <span className="num self-end text-[13px] text-faint">
          {value.text.length.toLocaleString("ja-JP")} / {MAX_X_POST_TEXT.toLocaleString("ja-JP")}
        </span>
      </div>

      {/* 文を貼らないときは、URL だけでは中身がわからないので 1 問だけ聞く */}
      {!value.text.trim() && (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface2 px-4 py-3">
          <label htmlFor="idea-x-interest" className="text-[15px] leading-[1.7]">
            {X_POST_INTEREST_QUESTION}
            <span className="ml-1.5 text-[13px] text-faint">文を貼らないときは答えてください</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {X_POST_INTEREST_CHOICES.map((c) => (
              <button key={c} type="button" aria-pressed={value.interest === c} onClick={() => set({ interest: c })} className={chipClass({ on: value.interest === c })}>
                {c}
              </button>
            ))}
          </div>
          <Input id="idea-x-interest" value={value.interest} maxLength={MAX_X_POST_INTEREST} onChange={(e) => set({ interest: e.target.value })} placeholder="自分の言葉で答えても大丈夫です" />
        </div>
      )}
    </div>
  );
}

// 中身が入ったか（ネタを出すボタンを押せるか）
export function xPostReady(v: XPostValue): boolean {
  return Boolean(parseXPostUrl(v.url)) && (v.text.trim() !== "" || v.interest.trim() !== "");
}
