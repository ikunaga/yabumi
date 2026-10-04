import { notFound } from "next/navigation";
import { ProjectShell } from "@/components/nav/project-shell";
import { requireUser } from "@/lib/auth/user";
import { getProject, listProjectNames } from "@/lib/projects/queries";
import { isUuid } from "@/lib/uuid";

export default async function ProjectLayout(props: LayoutProps<"/projects/[id]">) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();
  const [user, project, projects] = await Promise.all([requireUser(), getProject(id), listProjectNames()]);
  if (!project) notFound();

  return (
    <ProjectShell project={project} projects={projects} email={user.email}>
      {props.children}
    </ProjectShell>
  );
}
