"use client";

import { ShortLinkToggle } from "@/components/links/short-link-toggle";
import { planShortLinks } from "@/lib/links/rules";
import { findUrls, sameUrl } from "@/lib/posts/profile-link";
import { DestinationInsert } from "../destination-insert";
import { LearningTip } from "@/components/learning/learning-tip";
import { Term } from "@/components/ui/term";
import { hasUrl } from "@/lib/learning/tips";
import { type Composer } from "./use-composer";

// ④ リンク: 行き先の URL・短縮リンク（compose-steps.md）
export function ComposeShortLinks({ c }: { c: Composer }) {
  const { projectId, profileLink, shortLinks, setShortLinks, body, insertedUrl, textFor, chosen, toSend, insertDestination, learnFrom, mode } = c;
  return (
    <>
      {/* 「行き先」「短縮リンク」が何かを 1 行で（2026-11-18 PMO の付箋 22。短縮リンクの説明は用語の点線から） */}
      {mode !== "all_sent" && (
        <p className="text-[13px] leading-[1.7] text-muted">
          行き先は、見た人に開いてほしいページです（お店の予約・商品・アプリのストアのページなど）。本文に URL を入れると、<Term k="shortLink">短縮リンク</Term>で押された回数を数えられます。要らなければ、このまま次へ。
        </p>
      )}
      {(chosen.length === 0 || toSend.length > 0) && (
        <ShortLinkToggle
          checked={shortLinks}
          onChange={setShortLinks}
          projectId={projectId}
          body={body}
          targets={toSend.map((sns) => ({ sns, text: textFor(sns) }))}
          insert={<DestinationInsert projectId={projectId} destinations={profileLink?.destinations ?? []} onInsert={insertDestination} />}
        />
      )}
      {insertedUrl && shortLinks && (chosen.length === 0 ? findUrls(body) : toSend.filter((s) => planShortLinks([{ sns: s, text: textFor(s) }]).replaced.length > 0).flatMap((s) => findUrls(textFor(s)))).some((u) => sameUrl(u, insertedUrl)) && (
        <p className="-mt-1.5 text-[13px] text-muted">
          <span aria-hidden className="mr-1 font-bold text-success">
            ✓
          </span>
          行き先の URL を本文に入れました。送るとき、SNS ごとの短縮リンクに置き換えます。
        </p>
      )}
      {/* 本文の URL の「ひとこと」（短縮リンクのすすめ）。短縮リンクがオンなら、もう入っているので出さない（PMO の確かめ。前は ② に、X の上限の知らせと並んで出ていた） */}
      {mode !== "all_sent" && <LearningTip trigger="url_in_body" when={!learnFrom.url && !shortLinks && chosen.some((s) => hasUrl(textFor(s)))} />}
    </>
  );
}
