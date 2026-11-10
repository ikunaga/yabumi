"use client";

import { ShortLinkToggle } from "@/components/links/short-link-toggle";
import { planShortLinks } from "@/lib/links/rules";
import { findUrls, sameUrl } from "@/lib/posts/profile-link";
import { DestinationInsert } from "../destination-insert";
import { type Composer } from "./use-composer";

// ④ リンク: 行き先の URL・短縮リンク（compose-steps.md）
export function ComposeShortLinks({ c }: { c: Composer }) {
  const { projectId, profileLink, shortLinks, setShortLinks, body, insertedUrl, textFor, chosen, toSend, insertDestination } = c;
  return (
    <>
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
    </>
  );
}
