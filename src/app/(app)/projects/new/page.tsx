import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/top-bar";
import { ProjectForm } from "@/components/projects/project-form";
import { requireUser } from "@/lib/auth/user";
import { createProject } from "@/lib/projects/actions";

export const metadata: Metadata = { title: "新しいプロジェクト" };

export default async function NewProjectPage() {
  const user = await requireUser();

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
        <ProjectForm
          action={createProject}
          title="新しいプロジェクト"
          lead="あとからいつでも編集できます。まずはアプリ名だけでも大丈夫です。"
          submitLabel="作成する"
          cancelHref="/projects"
        />
      </main>
    </>
  );
}
