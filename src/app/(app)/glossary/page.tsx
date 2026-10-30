import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/top-bar";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/user";
import { GLOSSARY_KEYS, glossary, termTitle, type GlossaryTerm } from "@/lib/glossary/terms";

export const metadata: Metadata = { title: "用語集" };

export default async function GlossaryPage() {
  const user = await requireUser();

  return (
    <>
      <TopBar
        email={user.email}
        crumb={<span className="font-bold text-fg">用語集</span>}
        mobileBack={{ href: "/projects", title: "用語集" }}
      />
      <main className="flex flex-col gap-5 px-12 py-10 max-lg:px-8 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <PageHeader title="用語集" sub={`${GLOSSARY_KEYS.length} 語`} help="矢書の画面に出てくるマーケティングの言葉を、平易に説明しています。画面の点線の言葉を押しても、同じ説明が出ます。" />
        <Card className="overflow-hidden">
          {/* 広い画面では 2 列に並べる（1 語ずつは短い文なので、1 列だと右が空く） */}
          <dl className="grid xl:grid-cols-2">
            {GLOSSARY_KEYS.map((k) => {
              const term: GlossaryTerm = glossary[k];
              return (
                <div key={k} id={k} className="scroll-mt-24 border-b border-line px-6 py-5 target:bg-signal-soft xl:odd:border-r max-sm:px-4">
                  <dt className="text-[18px] font-bold">{termTitle(term)}</dt>
                  <dd className="mt-1.5 text-[15px] leading-[1.8]">
                    {term.summary}
                    {term.example && <span className="mt-1 block text-muted">{term.example}</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>
        <Link href="/projects" className="text-[15px] text-muted hover:text-fg hover:no-underline">
          ← プロジェクトへ戻る
        </Link>
      </main>
    </>
  );
}
