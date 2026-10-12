import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotesBoard } from "@/components/notes/notes-board";
import { SuccessBanner } from "@/components/ui/feedback";
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
    <div className="flex max-w-[960px] flex-col gap-6 max-sm:gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">ネタ帳</h1>
        <p className="text-base leading-[1.8] text-muted max-sm:text-[14px]">
          生活の中で思いついたことや、あったことを、メモにさっと残しておく場所です。使った人の声、つまずいたこと、作っていて気づいたことは、そのまま投稿の種になります。メモを選ぶと、AI が <Term k="contentPillar" /> と口調に沿って、投稿のネタと下書きにします。
        </p>
      </div>
      {done === "saved" && <SuccessBanner>ネタ帳に残しました</SuccessBanner>}
      <NotesBoard projectId={project.id} projectName={project.name} notes={notes} aiEnabled={aiConfigured()} />
    </div>
  );
}
