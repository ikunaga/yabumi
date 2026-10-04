import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/top-bar";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/user";
import { GLOSSARY_KEYS, glossary, termTitle, type GlossaryTerm } from "@/lib/glossary/terms";

export const metadata: Metadata = { title: "用語集" };

export default async function GlossaryPage() {
  const user = await requireUser();

  return (
    <>
      <TopBar
        email={user.email}
        crumb={<span className="font-bold text-primary">用語集</span>}
        mobileBack={{ href: "/projects", title: "用語集" }}
      />
      <main className="flex max-w-[800px] flex-col gap-7 px-12 py-12 max-lg:px-6 max-sm:gap-5 max-sm:px-5 max-sm:py-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">用語集</h1>
          <p className="text-base text-muted">矢書の画面に出てくるマーケティングの言葉を、平易に説明しています。</p>
        </div>
        <Card>
          <dl>
            {GLOSSARY_KEYS.map((k) => {
              const term: GlossaryTerm = glossary[k];
              return (
                <div key={k} id={k} className="scroll-mt-6 border-b border-line px-6 py-5 last:border-b-0 target:bg-primary-soft max-sm:px-4">
                  <dt className="text-lg font-bold">{termTitle(term)}</dt>
                  <dd className="mt-1.5 leading-[1.8]">
                    {term.summary}
                    {term.example && <span className="mt-1 block text-muted">{term.example}</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>
        <Link href="/projects" className="text-[14px] text-primary hover:underline">
          ← プロジェクトへ戻る
        </Link>
      </main>
    </>
  );
}
