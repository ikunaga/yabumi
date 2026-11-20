"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/chip";
import { KIND_DESCRIPTIONS, KIND_LABELS } from "@/lib/auto-post/labels";
import { AUTO_KINDS, AUTO_KINDS_STAGE_A, type AutoKind } from "@/lib/auto-post/types";
import type { SeriesFormatCard } from "@/lib/auto-post/ui-queries";
import { DisclosureBox } from "@/components/ui/disclosure";

// 自動の投稿の「1 何を」（docs/design/auto-post.md の 1.4。2026-11-18 オーナーの了承した見本 auto-post-step1-mock）。
// 投稿のネタの出どころを 1 つ選ぶ（radio）。シリーズはフォーマットごとに 1 枚。おすすめは印だけで、初めから選んでおく。
// 選べないカードは点線で薄くし、理由と直し方のリンクを出す。準備中は畳んで下にまとめる

export type KindChoice = { kind: AutoKind; formatId?: string };

export type PickerMaterials = {
  seriesFormats: SeriesFormatCard[];
  destinations: { id: string; label: string }[];
  events: number;
  pillarNames: string[];
  unusedNotes: number;
  unusedPhotoNotes: number;
};

// 伸びた投稿から（docs/design/winning-posts.md の 3. の A）。選ぶカードではなく、伸びた投稿の画面へのリンク。
// text は「Threads でいつもの 2.4 倍見られた投稿が 2 本あります」、off は「あと 3 本送ると、伸びた投稿がわかります」
export type WinnersCard = { text: string; off: boolean };

export const choiceKey = (c: KindChoice | null) => (c ? (c.kind === "series" ? `series:${c.formatId ?? ""}` : c.kind) : "");

type Card = {
  key: string;
  choice: KindChoice;
  title: string;
  series?: boolean;
  description: ReactNode;
  example?: string;
  count?: string;
  off?: { reason: string; href: string; hrefLabel: string };
};

// 投稿の例は 1 行にまとめる（改行は「／」）。長ければ切る
function exampleLine(text: string): string | undefined {
  const s = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("／");
  if (!s) return undefined;
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

export function kindCards(m: PickerMaterials, projectId: string, formatsHref: string): Card[] {
  const base = `/projects/${projectId}`;
  const cards: Card[] = [];
  if (m.seriesFormats.length) {
    for (const f of m.seriesFormats)
      cards.push({
        key: choiceKey({ kind: "series", formatId: f.id }),
        choice: { kind: "series", formatId: f.id },
        title: f.name,
        series: true,
        description: KIND_DESCRIPTIONS.series,
        example: exampleLine(f.example),
        count: `これまでの投稿 ${f.rounds} 件`,
      });
  } else {
    cards.push({
      key: "series:",
      choice: { kind: "series" },
      title: KIND_LABELS.series,
      description: KIND_DESCRIPTIONS.series,
      off: { reason: "シリーズにしたフォーマットがまだありません", href: formatsHref, hrefLabel: "フォーマットを作る" },
    });
  }
  cards.push({
    key: "notes",
    choice: { kind: "notes" },
    title: KIND_LABELS.notes,
    description: KIND_DESCRIPTIONS.notes,
    count: m.unusedNotes
      ? `まだ使っていないメモ ${m.unusedNotes} 件${m.unusedPhotoNotes ? `（写真つき ${m.unusedPhotoNotes}）` : ""}・使い切ったら自動投稿は止まり、お知らせします`
      : undefined,
    off: m.unusedNotes ? undefined : { reason: "まだ使っていないメモがありません", href: `${base}/notes`, hrefLabel: "メモを書く" },
  });
  cards.push({
    key: "pillars",
    choice: { kind: "pillars" },
    title: KIND_LABELS.pillars,
    description: (
      <>
        決めておいた発信のテーマごとに、AI が投稿を書きます。テーマは 1 つずつ順番に使います。
      </>
    ),
    example: m.pillarNames[0] ? `「${m.pillarNames[0]}」の柱から、1 つ取り上げた投稿` : undefined,
    count: m.pillarNames.length ? `柱 ${m.pillarNames.length} つ` : undefined,
    off: m.pillarNames.length ? undefined : { reason: "発信のテーマがまだありません", href: `${base}/plan`, hrefLabel: "発信のテーマを決める" },
  });
  cards.push({
    key: "events",
    choice: { kind: "events" },
    title: KIND_LABELS.events,
    description: KIND_DESCRIPTIONS.events,
    count: m.events ? `登録したお知らせ ${m.events} 件` : "登録したお知らせはまだありません（季節のあいさつだけ）",
  });
  cards.push({
    key: "product",
    choice: { kind: "product" },
    title: KIND_LABELS.product,
    description: KIND_DESCRIPTIONS.product,
    count: m.destinations.length ? `行き先 ${m.destinations.length} 件` : undefined,
    off: m.destinations.length ? undefined : { reason: "商品のページのリンクがまだありません", href: `${base}/edit`, hrefLabel: "商品のページのリンクを入れる" },
  });
  return cards;
}

export function KindPicker({
  cards,
  value,
  suggestedKey,
  isApp,
  winners,
  winnersHref,
  onChange,
}: {
  cards: Card[];
  value: string;
  suggestedKey: string | null;
  isApp: boolean;
  winners?: WinnersCard | null;
  winnersHref?: string;
  onChange: (c: KindChoice) => void;
}) {
  // おすすめを先頭（横いっぱい）に、選べるもの、選べないものの順
  const ordered = [...cards.filter((c) => c.key === suggestedKey && !c.off), ...cards.filter((c) => c.key !== suggestedKey && !c.off), ...cards.filter((c) => c.off)];
  const soon = AUTO_KINDS.filter((k) => !AUTO_KINDS_STAGE_A.includes(k) && (k !== "commits" || isApp));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[18px] font-bold">何を投稿する？</h2>
        <p className="text-[14px] text-muted">投稿のネタをどこから作るかを、1 つ選びます。ほかのネタでも回したいときは、あとで自動投稿をもう 1 つ作れます。</p>
      </div>
      {winners && winnersHref && (
        <Link
          href={winnersHref}
          className={`flex flex-col gap-1 rounded-lg px-4 py-3.5 text-fg hover:no-underline ${winners.off ? "border border-dashed border-border" : "border border-border bg-surface hover:bg-subtle"}`}
        >
          <span className={`flex flex-wrap items-center gap-2 text-[16px] font-bold ${winners.off ? "text-faint" : ""}`}>
            自分の投稿でよく見られたものから
            <span aria-hidden className="ml-auto text-[14px] font-normal text-muted">
              →
            </span>
          </span>
          <span className={`text-[14px] ${winners.off ? "text-faint" : "text-muted"}`}>自分の投稿で、よく見られたものの書き方をまねます。それをもとに、AI が毎回新しい投稿を書きます。</span>
          <span className="num mt-0.5 text-[13px] text-faint">{winners.off ? `いまは選べません：${winners.text}` : winners.text}</span>
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1" role="radiogroup" aria-label="投稿のネタ">
        {ordered.map((c) => {
          const on = !c.off && c.key === value;
          const suggested = c.key === suggestedKey && !c.off;
          return (
            <div
              key={c.key}
              onClick={(e) => {
                // 用語の説明（body に出るので、React の上では中から届く）・リンクを押したときは選ばない。丸と名前のボタン・カードの余白で選ぶ
                const t = e.target as HTMLElement;
                if (c.off || !e.currentTarget.contains(t)) return;
                const control = t.closest("a, button");
                if (control && control.getAttribute("role") !== "radio") return;
                onChange(c.choice);
              }}
              className={`relative flex flex-col gap-1 rounded-lg px-4 py-3.5 pl-12 ${suggested ? "col-span-full" : ""} ${
                c.off ? "border border-dashed border-border" : `cursor-pointer bg-surface hover:bg-subtle ${on ? "border-2 border-primary px-[15px] py-[13px] pl-[47px]" : "border border-border"}`
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!!c.off}
                className="flex flex-wrap items-center gap-2 text-left text-[16px] font-bold disabled:cursor-default disabled:text-faint"
              >
                <span
                  aria-hidden
                  className={`absolute top-[18px] left-4 flex size-5 items-center justify-center rounded-full border-[1.5px] text-[12px] ${
                    on ? "border-primary bg-primary text-on-primary" : c.off ? "border-dashed border-faint opacity-50" : "border-faint"
                  }`}
                >
                  {on ? "✓" : ""}
                </span>
                {c.title}
                {c.series && <Badge>シリーズ</Badge>}
                {suggested && <Badge>おすすめ</Badge>}
              </button>
              <p className={`text-[14px] ${c.off ? "text-faint" : "text-muted"}`}>{c.description}</p>
              {!c.off && c.example && (
                <p className="mt-1 rounded-md bg-subtle px-2.5 py-2 text-[13px] text-fg">
                  <span className="text-faint">例　</span>
                  {c.example}
                </p>
              )}
              {!c.off && c.count && <p className="num mt-0.5 text-[13px] text-faint">{c.count}</p>}
              {c.off && (
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-fg">
                  <span>いまは選べません：{c.off.reason}</span>
                  <Link href={c.off.href} className="font-bold underline">
                    {c.off.hrefLabel} →
                  </Link>
                </p>
              )}
            </div>
          );
        })}
      </div>
      {soon.length > 0 && (
        <DisclosureBox label="まだ選べないネタを表示" count={soon.length}>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[14px] text-muted">
            {soon.map((k) => (
              <li key={k}>
                {KIND_LABELS[k]}：{KIND_DESCRIPTIONS[k as Exclude<AutoKind, "pillars">]}
              </li>
            ))}
          </ul>
        </DisclosureBox>
      )}
    </div>
  );
}
