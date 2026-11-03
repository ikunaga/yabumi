import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryNav } from "@/components/glossary/category-nav";
import { GlossaryFrame } from "@/components/glossary/frame";
import { TermCard } from "@/components/glossary/term-card";
import { PageHeader } from "@/components/ui/page-header";
import { categoryById, GLOSSARY_CATEGORY_IDS, isGlossaryCategoryId } from "@/lib/glossary/terms";
import { loadTermReads } from "@/lib/learning/today";
import { createClient } from "@/lib/supabase/server";

// 用語集の分類のページ（4.49）。上に分類の切り替え、その分類の語のカードだけを並べる。知らない分類は 404（dynamicParams = false）
export const dynamicParams = false;

export function generateStaticParams() {
  return GLOSSARY_CATEGORY_IDS.map((id) => ({ id }));
}

export async function generateMetadata(props: PageProps<"/glossary/c/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: isGlossaryCategoryId(id) ? `${categoryById(id).label}（用語集）` : "用語集" };
}

export default async function GlossaryCategoryPage(props: PageProps<"/glossary/c/[id]">) {
  const { id } = await props.params;
  if (!isGlossaryCategoryId(id)) notFound();
  const category = categoryById(id);
  // 読んだ語（学びの記録。4.47）。読めなくても出す
  const read = await loadTermReads(await createClient()).catch(() => new Set<string>());

  return (
    // プロジェクトの中から開いたら、そのプロジェクトの上の帯のまま（4.48）
    <GlossaryFrame
      crumb={
        <span className="flex items-center gap-2">
          <Link href="/glossary" className="text-muted hover:text-fg hover:no-underline">
            用語集
          </Link>
          <span aria-hidden className="text-faint">
            ›
          </span>
          <span className="font-bold text-fg">{category.label}</span>
        </span>
      }
      mobileBack={{ href: "/glossary", title: category.label }}
    >
      <div className="flex flex-col gap-5 max-sm:gap-4">
        <nav aria-label="パンくず" className="text-[14px] text-muted">
          <Link href="/glossary" className="hover:text-fg">
            用語集
          </Link>
          <span aria-hidden className="mx-1.5 text-faint">
            ›
          </span>
          <span className="text-fg">{category.label}</span>
        </nav>
        <PageHeader title={category.label} sub={`${category.keys.length} 語・読んだ ${category.keys.filter((k) => read.has(k)).length} / ${category.keys.length}`} />
        <p className="-mt-2 text-[15px] leading-[1.8] text-muted max-sm:mt-0">{category.note}</p>
        <CategoryNav current={category.id} />

        <ul className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1 max-sm:gap-3">
          {category.keys.map((k) => (
            <li key={k}>
              <TermCard k={k} read={read.has(k)} />
            </li>
          ))}
        </ul>

        <Link href="/glossary" className="text-[15px] text-muted hover:text-fg hover:no-underline">
          ← 用語集の入口へ戻る
        </Link>
      </div>
    </GlossaryFrame>
  );
}
