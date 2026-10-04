import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { logout } from "@/lib/auth/actions";

// プロジェクト一覧・作成画面の上部バー（高さ 64、surface 地）
export function TopBar({
  email,
  crumb,
  mobileBack,
}: {
  email: string;
  crumb?: ReactNode;
  // スマホでは「← 戻る」と画面名だけを出す
  mobileBack?: { href: string; title: string };
}) {
  return (
    <header className="border-b border-border bg-surface">
      <div className={`flex h-16 items-center gap-9 px-12 max-lg:px-6 max-sm:h-auto max-sm:px-5 max-sm:pt-[22px] max-sm:pb-3.5 ${mobileBack ? "max-sm:hidden" : ""}`}>
        <Brand href="/projects" />
        <nav aria-label="パンくず" className="text-[14px] max-sm:hidden">
          {crumb ?? (
            <Link href="/projects" className="font-bold text-primary" aria-current="page">
              プロジェクト
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-6 text-sm text-muted max-sm:gap-4">
          <ThemeToggle />
          <span className="max-sm:hidden">{email}</span>
          <form action={logout}>
            <button type="submit" className="hover:text-fg hover:underline">
              ログアウト
            </button>
          </form>
        </div>
      </div>
      {mobileBack && (
        <div className="flex items-center gap-3.5 px-5 pt-[22px] pb-3.5 text-base sm:hidden">
          <Link href={mobileBack.href} className="text-primary">
            ← 戻る
          </Link>
          <b>{mobileBack.title}</b>
          <span className="ml-auto">
            <ThemeToggle />
          </span>
        </div>
      )}
    </header>
  );
}
