"use client";

import Link from "next/link";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useRef } from "react";
import { QuickNote } from "@/components/notes/quick-note";
import { DismissableDetails } from "@/components/ui/dismissable-details";
import { logout } from "@/lib/auth/actions";
import { activeNavKey, projectNavItems } from "./project-nav-items";

// スマホのヘッダーの「メニュー」。下のタブに入らない画面（アカウント設計・リンク・ロードマップ）と、アカウント・ログアウトへの入口。
// プロジェクトの切り替えとは役目が違うので分ける（切り替えはプロジェクト名、ここは画面の一覧）
export function ProjectMobileMenu({ projectId, email, projects }: { projectId: string; email: string; projects: { id: string; name: string }[] }) {
  const active = activeNavKey(useSelectedLayoutSegment());
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const items = projectNavItems(projectId);

  // 画面を移ったら閉じる（ヘッダーは画面をまたいで残るため）
  useEffect(() => {
    const details = ref.current?.closest("details");
    if (details) details.open = false;
  }, [pathname]);

  return (
    <DismissableDetails className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-nav-fg hover:text-nav-strong [&::-webkit-details-marker]:hidden">
        <span aria-hidden>≡</span>
        メニュー
      </summary>
      <div ref={ref} className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-surface py-1 text-sm text-fg shadow-pop">
        <div className="border-b border-line pb-1">
          <QuickNote projects={projects} projectId={projectId} variant="menu" />
        </div>
        <nav aria-label="プロジェクトのすべての画面">
          <ul>
            {items.map((item) =>
              item.href ? (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={item.key === active ? "page" : undefined}
                    className="block px-4 py-3 hover:bg-primary-soft hover:no-underline aria-[current=page]:font-bold aria-[current=page]:text-primary"
                  >
                    {item.label}
                  </Link>
                </li>
              ) : (
                <li key={item.key}>
                  <span className="flex items-center justify-between px-4 py-3 opacity-55" aria-disabled="true">
                    {item.label}
                    <span className="text-[11px]">準備中</span>
                  </span>
                </li>
              ),
            )}
          </ul>
        </nav>
        <div className="mt-1 border-t border-line pt-1">
          <Link href="/settings" className="block px-4 py-3 hover:bg-primary-soft hover:no-underline">
            ログインと退会
            <span className="block truncate text-xs text-muted">{email}</span>
          </Link>
          <form action={logout}>
            <button type="submit" className="block w-full px-4 py-3 text-left hover:bg-primary-soft">
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </DismissableDetails>
  );
}
