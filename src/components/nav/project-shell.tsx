import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { QuickNote, QuickNoteFab } from "@/components/notes/quick-note";
import { AccountMenu } from "./account-menu";
import { ProjectMobileMenu } from "./project-mobile-menu";
import { ProjectNavLinks } from "./project-nav-links";
import { ProjectSwitcher } from "./project-switcher";

// プロジェクト内の画面の枠（決定 D33）。PC は上の横並びのメニュー（ロゴ・プロジェクトの切り替え・5 項目・その他・＋ メモ・アカウント）。
// スマホは上の帯（ロゴ・プロジェクト名・メニュー）と下のタブ（5 項目）
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
    <div className="flex flex-1 flex-col">
      {/* PC: 上の横並びのメニュー */}
      <header className="sticky top-0 z-20 border-b border-border bg-nav max-sm:hidden">
        <div className="flex h-16 items-center gap-6 px-12 max-lg:gap-3 max-lg:px-8">
          <Brand href="/projects" />
          <ProjectSwitcher current={project} projects={projects} variant="bar" />
          <nav aria-label="プロジェクトのメニュー" className="min-w-0">
            <ProjectNavLinks projectId={project.id} variant="bar" />
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <QuickNote projects={projects} projectId={project.id} variant="topbar" />
            <AccountMenu email={email} />
          </div>
        </div>
      </header>

      {/* スマホ: 上の帯 */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-nav px-4 pt-[18px] pb-3 sm:hidden">
        <Brand href="/projects" size="sm" />
        <div className="flex min-w-0 items-center gap-4 max-[359px]:gap-3">
          <ProjectSwitcher current={project} projects={projects} variant="header" />
          <ProjectMobileMenu projectId={project.id} email={email} projects={projects} />
        </div>
      </header>

      <main className="min-w-0 flex-1 px-12 py-10 max-lg:px-8 max-sm:px-4 max-sm:pt-5 max-sm:pb-28">{children}</main>

      {/* スマホ: ネタ帳に残す「＋ メモ」（下のタブの上の右下） */}
      <QuickNoteFab projects={projects} projectId={project.id} />

      {/* スマホ: 下のタブ */}
      <nav
        aria-label="プロジェクトのメニュー"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-nav pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <ProjectNavLinks projectId={project.id} variant="tabs" />
      </nav>
    </div>
  );
}
