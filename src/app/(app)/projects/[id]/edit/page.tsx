import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeleteProjectButton } from "@/components/projects/delete-project-button";
import { ProjectForm } from "@/components/projects/project-form";
import { Card, CardHeader } from "@/components/ui/card";
import { updateProject } from "@/lib/projects/actions";
import { getProject } from "@/lib/projects/queries";

export const metadata: Metadata = { title: "プロジェクトを編集" };

export default async function EditProjectPage(props: PageProps<"/projects/[id]/edit">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-10">
      <ProjectForm
        action={updateProject.bind(null, project.id)}
        initial={project}
        title="プロジェクトを編集"
        submitLabel="保存する"
        cancelHref={`/projects/${project.id}`}
      />
      <Card className="max-w-[680px] border-danger/50">
        <CardHeader title={<span className="text-danger">プロジェクトを削除</span>} />
        <div className="flex flex-col gap-4 px-5 py-5 max-sm:px-4">
          <p className="text-[14px] text-muted">削除すると、このプロジェクトの情報は元に戻せません。</p>
          <DeleteProjectButton projectId={project.id} projectName={project.name} />
        </div>
      </Card>
    </div>
  );
}
