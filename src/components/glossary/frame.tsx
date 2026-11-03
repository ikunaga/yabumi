import "server-only";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { ProjectShell } from "@/components/nav/project-shell";
import { TopBar } from "@/components/nav/top-bar";
import { requireUser } from "@/lib/auth/user";
import { LAST_PROJECT_COOKIE, lastProjectFor } from "@/lib/projects/last-project";
import { listProjectNames } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

// 用語集の画面の枠（4.48）。プロジェクトの中から開いたら（直前に開いていたプロジェクトが本人のもの）、そのプロジェクトの上の帯
// （切り替え・Overview〜More・スマホの下のタブ）のまま出し、More の Glossary を選んだ印にする。
// プロジェクトの一覧から開いた・プロジェクトがない・cookie の id が本人のものでない／消えた／形が違うときは、プロジェクトの外の帯
export async function GlossaryFrame({ crumb, mobileBack, children }: { crumb: ReactNode; mobileBack: { href: string; title: string }; children: ReactNode }) {
  const user = await requireUser();
  const project = await lastProjectFor(await createClient(), (await cookies()).get(LAST_PROJECT_COOKIE)?.value);
  if (project) {
    return (
      <ProjectShell project={project} projects={await listProjectNames()} email={user.email} glossary>
        {children}
      </ProjectShell>
    );
  }
  return (
    <>
      <TopBar email={user.email} crumb={crumb} mobileBack={mobileBack} glossary />
      <main className="min-w-0 flex-1 px-12 py-10 max-lg:px-8 max-sm:px-4 max-sm:py-5">{children}</main>
    </>
  );
}
