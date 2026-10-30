import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { PublicFooter } from "@/components/public/public-frame";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LegalChangeNotice, LegalHistory } from "./legal-notice";
import { effectiveDateLabel, type LegalDoc } from "@/lib/legal/version";

// 利用規約とプライバシーポリシーの共通の枠。ログインなしで開ける（src/lib/supabase/proxy.ts の PUBLIC_PATHS）
export function LegalPage({ doc, title, lead, children }: { doc: LegalDoc; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-bg">
      <header className="border-b border-border bg-nav">
        <div className="flex h-[68px] items-center gap-4 px-12 max-lg:px-8 max-sm:h-14 max-sm:px-4">
          <span className="flex max-sm:hidden">
            <Brand href="/" />
          </span>
          <span className="flex sm:hidden">
            <Brand href="/" size="sm" />
          </span>
          <nav className="ml-auto flex items-center gap-5 text-[15px] text-muted max-sm:gap-4">
            <ThemeToggle />
            <Link href="/login" className="font-bold text-fg hover:underline">
              ログイン
            </Link>
          </nav>
        </div>
      </header>

      {/* 文を読む画面なので、読みやすい幅に狭める（docs/design/new_design/README.md の「中身の幅と 2 列」） */}
      <main className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-8 py-10 max-sm:gap-5 max-sm:px-4 max-sm:py-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] leading-tight font-bold max-sm:text-[24px]">{title}</h1>
          <p className="num text-[15px] text-faint">施行日: {effectiveDateLabel(new Date(), doc)}</p>
        </div>
        <LegalChangeNotice />
        <article className="flex flex-col gap-8 rounded-lg border border-border bg-surface px-10 py-9 text-base max-sm:gap-6 max-sm:px-5 max-sm:py-6">
          <div className="leading-[1.9]">{lead}</div>
          {children}
        </article>
        <LegalHistory />
      </main>

      <PublicFooter />
    </div>
  );
}

export function LegalSection({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-3">
      <h2 className="text-[20px] font-bold max-sm:text-[18px]">
        第 {n} 条　{title}
      </h2>
      <div className="flex flex-col gap-3 leading-[1.9]">{children}</div>
    </section>
  );
}

// 番号つきの項（1. 2. …）
export function Clauses({ items }: { items: ReactNode[] }) {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-6">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-6">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

// 表。スマホでは横にはみ出さないよう、行ごとの縦並びにする
export function LegalTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface text-[14px]">
      <table className="w-full border-collapse max-md:block">
        <thead className="max-md:hidden">
          <tr className="bg-surface2 text-left">
            {head.map((h) => (
              <th key={h} className="border-b border-line px-4 py-2.5 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-md:block">
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line align-top last:border-b-0 max-md:block max-md:px-4 max-md:py-3">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 leading-[1.7] max-md:block max-md:px-0 max-md:py-0.5">
                  <span className="hidden font-bold max-md:block max-md:text-xs max-md:text-muted">{head[j]}</span>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-all underline">
      {children}
    </a>
  );
}
