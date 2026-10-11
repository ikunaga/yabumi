import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LEGAL, orPending } from "@/lib/legal/info";

// 利用規約とプライバシーポリシーの共通の枠。ログインなしで開ける（src/lib/supabase/proxy.ts の PUBLIC_PATHS）
export function LegalPage({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col px-8 py-10 max-sm:px-4 max-sm:py-6">
      <header className="flex items-center gap-3">
        <Brand />
        <nav className="ml-auto flex items-center gap-5 text-[14px] text-muted">
          <ThemeToggle />
          <Link href="/login" className="hover:text-fg">
            ログイン
          </Link>
        </nav>
      </header>

      <main className="flex flex-col gap-6 py-10 max-sm:gap-5 max-sm:py-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">{title}</h1>
          <p className="text-[14px] text-muted">施行日: {orPending(LEGAL.effectiveDate)}</p>
        </div>
        {!LEGAL.effectiveDate && (
          <p role="note" className="rounded-md border border-border bg-surface2 px-4 py-3 text-[14px] leading-[1.7]">
            施行日は、登録の受付を開く日に決めて書き入れます。それまでは、内容を書き直すことがあります。
          </p>
        )}
        <div className="text-base leading-[1.9]">{lead}</div>
        <div className="flex flex-col gap-8 max-sm:gap-6">{children}</div>
      </main>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-5 text-[14px] text-muted">
        <Link href="/terms" className="hover:text-fg">
          利用規約
        </Link>
        <Link href="/privacy" className="hover:text-fg">
          プライバシーポリシー
        </Link>
        <Link href="/" className="hover:text-fg">
          トップ
        </Link>
      </footer>
    </div>
  );
}

export function LegalSection({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-3">
      <h2 className="font-heading text-xl font-bold max-sm:text-lg">
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
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
      {children}
    </a>
  );
}
