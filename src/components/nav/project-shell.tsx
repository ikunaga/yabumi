import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { logout } from "@/lib/auth/actions";
import { ProjectNavLinks } from "./project-nav-links";
import { ProjectSwitcher } from "./project-switcher";

// プロジェクト内の画面の枠。PC は左のサイドバー、スマホは上のヘッダーと下のタブ
export function ProjectShell({
  project,
  projects,
  email,
  children,
}: {
  project: { id: string; name: string };
  projects: { id: string; name: string }[];
  email: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 max-sm:flex-col">
      {/* PC: サイドバー */}
      <aside className="w-[220px] shrink-0 bg-nav text-nav-fg max-sm:hidden">
        <div className="sticky top-0 flex h-dvh flex-col gap-7 px-5 py-7">
        <Brand href="/projects" tone="nav" />
        <ProjectSwitcher current={project} projects={projects} variant="sidebar" />
        <nav aria-label="プロジェクトのメニュー">
          <ProjectNavLinks projectId={project.id} variant="sidebar" />
        </nav>
        <div className="mt-auto flex flex-col items-start gap-1 text-xs">
          <span className="mb-2">
            <ThemeToggle tone="nav" />
          </span>
          <span className="max-w-full truncate">{email}</span>
          <form action={logout}>
            <button type="submit" className="hover:text-nav-strong hover:underline">
              ログアウト
            </button>
          </form>
        </div>
        </div>
      </aside>

      {/* スマホ: 上のヘッダー */}
      <header className="flex items-center justify-between bg-nav px-5 pt-[22px] pb-4 text-nav-strong sm:hidden">
        <Brand href="/projects" tone="nav" size="sm" />
        <div className="flex items-center gap-4">
          <ThemeToggle tone="nav" />
          <ProjectSwitcher current={project} projects={projects} variant="header" />
        </div>
      </header>

      <main className="min-w-0 flex-1 px-12 py-10 max-lg:px-8 max-sm:px-4 max-sm:pt-5 max-sm:pb-28">{children}</main>

      {/* スマホ: 下のタブ */}
      <nav
        aria-label="プロジェクトのメニュー"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <ProjectNavLinks projectId={project.id} variant="tabs" />
      </nav>
    </div>
  );
}
