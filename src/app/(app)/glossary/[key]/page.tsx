import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GlossaryBlocks } from "@/components/glossary/blocks";
import { GLOSSARY_DIAGRAMS } from "@/components/glossary/diagrams";
import { Illustration } from "@/components/glossary/illustration";
import { TermMiniCard } from "@/components/glossary/term-card";
import { GlossaryFrame } from "@/components/glossary/frame";
import { RecordTermRead } from "@/components/glossary/record-read";
import { categoryOf, GLOSSARY_KEYS, glossary, isGlossaryKey, neighbors, type GlossaryTerm } from "@/lib/glossary/terms";

// 用語の詳細ページ（4.45）。挿絵・summary と例・図・くわしい説明（畳まずに全部）・関連・同じ分類の前と次。
// 知らない key は 404（dynamicParams = false）
export const dynamicParams = false;

export function generateStaticParams() {
  return GLOSSARY_KEYS.map((key) => ({ key }));
}

export async function generateMetadata(props: PageProps<"/glossary/[key]">): Promise<Metadata> {
  const { key } = await props.params;
  return { title: isGlossaryKey(key) ? `${glossary[key].label}（用語集）` : "用語集" };
}

export default async function GlossaryTermPage(props: PageProps<"/glossary/[key]">) {
  const { key } = await props.params;
  if (!isGlossaryKey(key)) notFound();
  const term: GlossaryTerm = glossary[key];
  const category = categoryOf(key);
  const { prev, next } = neighbors(key);
  const Diagram = GLOSSARY_DIAGRAMS[key];
  const related = (term.related ?? []).filter(isGlossaryKey);

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
          <span className="font-bold text-fg">{term.label}</span>
        </span>
      }
      mobileBack={{ href: `/glossary#cat-${category.id}`, title: "用語集" }}
    >
      {/* 読んだと記録する（学びの記録。4.47）。画面を描いたあとにクライアントから送る（GET や先読みでは記録しない） */}
      <RecordTermRead termKey={key} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 max-sm:gap-5">
        <nav aria-label="パンくず" className="text-[14px] text-muted">
          <Link href="/glossary" className="hover:text-fg">
            用語集
          </Link>
          <span aria-hidden className="mx-1.5 text-faint">
            ›
          </span>
          <Link href={`/glossary#cat-${category.id}`} className="hover:text-fg">
            {category.label}
          </Link>
        </nav>

        <header className="flex flex-col gap-1">
          <h1 className="text-[28px] leading-tight font-bold max-sm:text-[24px]">{term.label}</h1>
          {term.reading && <p className="text-[15px] text-muted">{term.reading}</p>}
        </header>

        <Illustration k={key} size="large" priority />

        <section className="flex flex-col gap-2 text-[16px] leading-[1.9]">
          <p>{term.summary}</p>
          {term.example && <p className="text-muted">{term.example}</p>}
        </section>

        {Diagram && <Diagram />}

        {term.details && <GlossaryBlocks blocks={term.details} />}

        {related.length > 0 && (
          <section aria-labelledby="related-title" className="flex flex-col gap-2.5">
            <h2 id="related-title" className="text-[16px] font-bold">
              関連する言葉
            </h2>
            <ul className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1 max-sm:gap-2">
              {related.map((r) => (
                <li key={r}>
                  <TermMiniCard k={r} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <nav aria-label={`「${category.label}」の前と次の言葉`} className="grid grid-cols-2 gap-3 border-t border-line pt-5 max-sm:grid-cols-1 max-sm:gap-2">
          <div>{prev && <TermMiniCard k={prev} note="← 前の言葉" />}</div>
          <div>{next && <TermMiniCard k={next} note="次の言葉 →" />}</div>
        </nav>

        <Link href={`/glossary#cat-${category.id}`} className="text-[15px] text-muted hover:text-fg hover:no-underline">
          ← 用語集へ戻る
        </Link>
      </div>
    </GlossaryFrame>
  );
}
