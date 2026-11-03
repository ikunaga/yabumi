import "server-only";
import Link from "next/link";
import { glossary, glossaryHref, termTitle, type GlossaryKey } from "@/lib/glossary/terms";
import { Illustration } from "./illustration";

// 用語集の一覧のカード（挿絵・名前と読み・summary の 2 行まで）。カード全体を押すと詳細ページへ（4.45）
export function TermCard({ k }: { k: GlossaryKey }) {
  const term = glossary[k];
  return (
    <Link
      id={k}
      href={glossaryHref(k)}
      className="flex h-full scroll-mt-24 flex-col gap-3 rounded-lg border border-border bg-surface p-3 text-fg hover:border-input hover:no-underline target:border-signal target:shadow-[0_0_0_1px_var(--signal)]"
    >
      <Illustration k={k} size="thumb" />
      <span className="flex flex-col gap-1 px-1 pb-1">
        <span className="text-[17px] leading-snug font-bold">{termTitle(term)}</span>
        <span className="line-clamp-2 text-[14px] leading-[1.7] text-muted">{term.summary}</span>
      </span>
    </Link>
  );
}

// 詳細ページの「関連」と前・次の、小さなカード（挿絵・名前）
export function TermMiniCard({ k, note }: { k: GlossaryKey; note?: string }) {
  const term = glossary[k];
  return (
    <Link href={glossaryHref(k)} className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface p-2.5 text-fg hover:border-input hover:no-underline">
      <Illustration k={k} size="small" />
      <span className="flex min-w-0 flex-col">
        {note && <span className="text-xs text-muted">{note}</span>}
        <span className="truncate text-[15px] font-bold">{term.label}</span>
      </span>
    </Link>
  );
}
