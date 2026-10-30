import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotesBoard } from "@/components/notes/notes-board";
import { SuccessBanner } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Term } from "@/components/ui/term";
import { aiConfigured } from "@/lib/ai/anthropic";
import { listNotes } from "@/lib/notes/queries";
import { getProject } from "@/lib/projects/queries";

export const metadata: Metadata = { title: "ネタ帳" };

// ネタ帳（要求 F17。docs/architecture.md の 4.26）。思いついたことや経験をメモに残し、投稿の材料にする
export default async function NotesPage(props: PageProps<"/projects/[id]/notes">) {
  const [{ id }, { done }] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const notes = await listNotes(id);

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title="ネタ帳"
        sub={`メモ ${notes.length} 件`}
        help={
          <>
            思いついたことや、あったことを、メモにさっと残しておく場所です。使った人の声、つまずいたこと、作っていて気づいたことは、そのまま投稿の種になります。メモを選ぶと、AI が <Term k="contentPillar" /> と口調に沿って、投稿のネタと下書きにします。
          </>
        }
      />
      {done === "saved" && <SuccessBanner>ネタ帳に残しました</SuccessBanner>}
      <NotesBoard projectId={project.id} projectName={project.name} notes={notes} aiEnabled={aiConfigured()} />
    </div>
  );
}
