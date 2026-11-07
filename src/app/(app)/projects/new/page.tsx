import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/top-bar";
import { ProjectForm } from "@/components/projects/project-form";
import { requireUser } from "@/lib/auth/user";
import { createProject } from "@/lib/projects/actions";
import { PROJECT_LIMIT_TEXT, projectLimitReached } from "@/lib/projects/limits";
import { listProjectNames } from "@/lib/projects/queries";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "新しいプロジェクト" };

export default async function NewProjectPage() {
  const [user, projects] = await Promise.all([requireUser(), listProjectNames()]);
  // 1 人 10 個まで。届いていたら、作る欄の代わりに案内を出す（作るボタンは出さない）
  const full = projectLimitReached(projects.length);

  return (
    <>
      <TopBar
        email={user.email}
        crumb={
          <span className="text-muted">
            <Link href="/projects" className="hover:text-fg hover:underline">
              プロジェクト
            </Link>{" "}
            ／ 新規
          </span>
        }
        mobileBack={{ href: "/projects", title: "新しいプロジェクト" }}
      />
      <main className="px-12 py-10 max-lg:px-6 max-sm:px-5 max-sm:py-5">
        {full ? (
          <Card className="mx-auto flex max-w-xl flex-col gap-3 p-6 max-sm:p-5">
            <h1 className="text-xl font-bold">{PROJECT_LIMIT_TEXT}</h1>
            <p className="text-sm text-muted">使っていないプロジェクトを、プロジェクトの設定から消すと、新しく作れます。</p>
            <ButtonLink href="/projects" variant="secondary" className="self-start">
              プロジェクトの一覧に戻る
            </ButtonLink>
          </Card>
        ) : (
          <ProjectForm
            action={createProject}
            title="新しいプロジェクト"
            lead="あとからいつでも編集できます。まずは名前だけでも大丈夫です。"
            submitLabel="作成する"
            pendingLabel="作成しています…"
            cancelHref="/projects"
          />
        )}
      </main>
    </>
  );
}
