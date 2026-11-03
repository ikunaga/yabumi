import type { Metadata } from "next";
import Link from "next/link";
import { CategoryCard } from "@/components/glossary/category-card";
import { GlossaryFrame } from "@/components/glossary/frame";
import { LegacyGlossaryHash } from "@/components/glossary/legacy-hash";
import { PageHeader } from "@/components/ui/page-header";
import { loadTermReads } from "@/lib/learning/today";
import { createClient } from "@/lib/supabase/server";
import { GLOSSARY_CATEGORIES, GLOSSARY_KEYS } from "@/lib/glossary/terms";

export const metadata: Metadata = { title: "用語集" };

// 用語集の入口（要求 F12、docs/architecture.md の 4.45・4.49）。6 つの分類のカード（代表の語の挿絵・名前・ひと言・語の数・読んだ数）。
// カードを押すと分類のページ（/glossary/c/<id>）。前の 1 ページの用語集のリンク（/glossary#<key>・#cat-<id>）は、ここで新しいページへ移す
export default async function GlossaryPage() {
  // 読んだ語（学びの記録。4.47）。読めなくても入口は出す
  const read = await loadTermReads(await createClient()).catch(() => new Set<string>());

  return (
    // プロジェクトの中から開いたら、そのプロジェクトの上の帯のまま（4.48）
    <GlossaryFrame crumb={<span className="font-bold text-fg">用語集</span>} mobileBack={{ href: "/projects", title: "用語集" }}>
      <LegacyGlossaryHash />
      <div className="flex flex-col gap-5 max-sm:gap-4">
        <PageHeader title="用語集" sub={`${GLOSSARY_KEYS.length} 語・読んだ語 ${GLOSSARY_KEYS.filter((k) => read.has(k)).length} / ${GLOSSARY_KEYS.length}`} />
        <p className="-mt-2 text-[15px] leading-[1.8] text-muted max-sm:mt-0">宣伝したいものを SNS で知ってもらうための、マーケティングの基本の言葉を集めました。気になる言葉から読んでみてください。</p>

        <ul aria-label="用語集の分類" className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1 max-sm:gap-3">
          {GLOSSARY_CATEGORIES.map((c) => (
            <li key={c.id}>
              <CategoryCard category={c} readCount={c.keys.filter((k) => read.has(k)).length} />
            </li>
          ))}
        </ul>

        <Link href="/projects" className="text-[15px] text-muted hover:text-fg hover:no-underline">
          ← プロジェクトへ戻る
        </Link>
      </div>
    </GlossaryFrame>
  );
}
