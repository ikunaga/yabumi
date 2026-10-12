import { listProjectNames } from "@/lib/projects/queries";
import { QuickNote } from "./quick-note";

// プロジェクトの外の画面（上部バー）の「＋ メモ」。どのプロジェクトのメモかは、開いたときに選ぶ
export async function QuickNoteEntry() {
  const projects = await listProjectNames();
  return (
    <>
      <QuickNote projects={projects} variant="topbar" />
      <QuickNote projects={projects} variant="fabFree" />
    </>
  );
}
