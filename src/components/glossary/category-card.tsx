import "server-only";
import Link from "next/link";
import { categoryHref, type GlossaryCategory } from "@/lib/glossary/terms";
import { Illustration } from "./illustration";

// 用語集の入口の、分類のカード（4.49）。代表の語の挿絵を小さく、名前・語の数・読んだ数・ひと言。押すと分類のページへ
export function CategoryCard({ category, readCount }: { category: GlossaryCategory; readCount: number }) {
  return (
    <Link
      href={categoryHref(category.id)}
      className="flex h-full items-center gap-4 rounded-lg border border-border bg-surface p-4 text-fg hover:border-input hover:no-underline max-sm:gap-3 max-sm:p-3"
    >
      <span className="w-24 shrink-0 max-sm:w-20">
        <Illustration k={category.cover} size="thumb-square" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[17px] leading-snug font-bold">{category.label}</span>
        <span className="text-[14px] leading-[1.6] text-muted">{category.note}</span>
        <span className="num text-xs text-faint">
          {category.keys.length} 語・読んだ {readCount} / {category.keys.length}
        </span>
      </span>
    </Link>
  );
}
