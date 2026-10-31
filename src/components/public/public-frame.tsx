import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/ui/theme-toggle";

// ログインなしで開く小さなページ（メールを止める・申し込みを取り消す・データ削除の確認など）の枠。
// 上に灰の帯（ロゴ・ダーク）、まん中に白いカードを 1 枚、下に規約へのリンク（見本の作り。2026-10-30 D33）
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-bg">
      <header className="border-b border-border bg-nav">
        <div className="flex h-[60px] items-center gap-4 px-12 max-lg:px-8 max-sm:h-14 max-sm:px-4">
          <span className="flex max-sm:hidden">
            <Brand href="/" />
          </span>
          <span className="flex sm:hidden">
            <Brand href="/" size="sm" />
          </span>
          <span className="ml-auto">
            <ThemeToggle />
          </span>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-16 max-sm:py-8">{children}</main>
      <PublicFooter />
    </div>
  );
}

// まん中のカード: 見出し・本文・ボタン。説明は短く、長いものは「?」や開く欄に畳む
export function PublicCard({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex w-full max-w-[520px] flex-col gap-4 rounded-lg border border-border bg-surface px-8 py-7 max-sm:px-5 max-sm:py-6">
      <h1 className="text-[22px] leading-snug font-bold max-sm:text-[20px]">{title}</h1>
      {children && <div className="flex flex-col gap-3 text-[15px] leading-[1.8]">{children}</div>}
      {actions && <div className="flex flex-wrap items-center gap-3 pt-1 max-sm:flex-col max-sm:items-stretch">{actions}</div>}
    </section>
  );
}

// ログインなしで開くページの下のリンク（LP・規約・ポリシーと同じ）
export function PublicFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-12 py-6 text-[14px] text-muted max-lg:px-8 max-sm:px-4 max-sm:text-[13px] ${className}`}>
      <Link href="/" className="hover:text-fg">
        トップ
      </Link>
      <Link href="/terms" className="hover:text-fg">
        利用規約
      </Link>
      <Link href="/privacy" className="hover:text-fg">
        プライバシーポリシー
      </Link>
      <Link href="/login" className="hover:text-fg">
        ログイン
      </Link>
    </footer>
  );
}
