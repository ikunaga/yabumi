import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { QuickNoteEntry } from "@/components/notes/quick-note-entry";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AccountMenu } from "./account-menu";
import { TopBarMenu } from "./top-bar-menu";

// プロジェクト一覧・作成画面の上部バー（高さ 56、白地。プロジェクトの中の上の帯と揃える）
export function TopBar({
  email,
  crumb,
  mobileBack,
  quickNote = true,
}: {
  email: string;
  crumb?: ReactNode;
  // スマホでは「← 戻る」と画面名だけを出す
  mobileBack?: { href: string; title: string };
  // ネタ帳の「＋ メモ」を出すか（メモを書く画面そのものでは出さない）
  quickNote?: boolean;
}) {
  return (
    <header className="border-b border-border bg-nav">
      <div className={`flex h-[60px] items-center gap-8 px-12 max-lg:px-8 max-sm:h-auto max-sm:px-4 max-sm:pt-[18px] max-sm:pb-3 ${mobileBack ? "max-sm:hidden" : ""}`}>
        <Brand href="/projects" />
        <nav aria-label="パンくず" className="text-[16px] font-semibold text-muted max-sm:hidden">
          {crumb ?? (
            <Link href="/projects" className="font-bold text-fg" aria-current="page">
              プロジェクト
            </Link>
          )}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3 text-sm text-muted max-sm:gap-4">
          {quickNote && <QuickNoteEntry />}
          <span className="max-sm:hidden">
            <AccountMenu email={email} />
          </span>
          <span className="sm:hidden">
            <ThemeToggle />
          </span>
          <span className="sm:hidden">
            <TopBarMenu email={email} />
          </span>
        </div>
      </div>
      {mobileBack && (
        <div className="flex items-center gap-3.5 px-4 pt-[18px] pb-3 text-base sm:hidden">
          <Link href={mobileBack.href} className="shrink-0 whitespace-nowrap text-muted hover:text-fg">
            ← 戻る
          </Link>
          <b className="min-w-0 truncate">{mobileBack.title}</b>
          <span className="ml-auto shrink-0">
            <ThemeToggle />
          </span>
        </div>
      )}
    </header>
  );
}
