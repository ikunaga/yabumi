import Link from "next/link";
import { categoryHref, GLOSSARY_CATEGORIES, type GlossaryCategoryId } from "@/lib/glossary/terms";

// 用語集の分類の切り替え（4.49）。分類のページの上に置き、いまの分類を選んだ印にする
export function CategoryNav({ current }: { current: GlossaryCategoryId }) {
  return (
    <nav aria-label="用語集の分類">
      <ul className="flex flex-wrap gap-2">
        {GLOSSARY_CATEGORIES.map((c) => (
          <li key={c.id}>
            <Link
              href={categoryHref(c.id)}
              aria-current={c.id === current ? "page" : undefined}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[14px] font-semibold text-fg hover:border-input hover:no-underline aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-on-primary"
            >
              {c.label}
              <span className="num text-xs font-normal opacity-70">{c.keys.length}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
