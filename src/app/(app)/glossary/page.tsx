import type { Metadata } from "next";
import Link from "next/link";
import { TermCard } from "@/components/glossary/term-card";
import { TopBar } from "@/components/nav/top-bar";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/user";
import { GLOSSARY_CATEGORIES, GLOSSARY_KEYS } from "@/lib/glossary/terms";

export const metadata: Metadata = { title: "用語集" };

// 用語集の一覧（要求 F12、docs/architecture.md の 4.45）。分類の目次と見出しの下に、語ごとのカード（挿絵・名前・summary の 2 行）。
// カードを押すと詳細ページ（/glossary/<key>）。前の /glossary#key のリンクは、この一覧のそのカードに飛ぶ
export default async function GlossaryPage() {
  const user = await requireUser();

  return (
    <>
      <TopBar email={user.email} crumb={<span className="font-bold text-fg">用語集</span>} mobileBack={{ href: "/projects", title: "用語集" }} glossary />
      <main className="flex flex-col gap-5 px-12 py-10 max-lg:px-8 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <PageHeader title="用語集" sub={`${GLOSSARY_KEYS.length} 語`} />
        <p className="-mt-2 text-[15px] leading-[1.8] text-muted max-sm:mt-0">SNS で知ってもらうための基本の言葉です。使いながら、気になったところから読んでください。</p>

        <nav aria-label="用語集の分類" className="flex flex-wrap gap-2">
          {GLOSSARY_CATEGORIES.map((c) => (
            <a
              key={c.id}
              href={`#cat-${c.id}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[14px] font-semibold text-fg hover:border-input hover:no-underline"
            >
              {c.label}
              <span className="num text-xs font-normal text-muted">{c.keys.length}</span>
            </a>
          ))}
        </nav>

        {GLOSSARY_CATEGORIES.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`cat-${c.id}-title`} className="flex scroll-mt-24 flex-col gap-3">
            <h2 id={`cat-${c.id}-title`} className="text-[18px] font-bold">
              {c.label}
            </h2>
            <ul className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1 max-sm:gap-3">
              {c.keys.map((k) => (
                <li key={k}>
                  <TermCard k={k} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        <Link href="/projects" className="text-[15px] text-muted hover:text-fg hover:no-underline">
          ← プロジェクトへ戻る
        </Link>
      </main>
    </>
  );
}
