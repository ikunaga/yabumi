import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EventsEditor } from "@/components/auto-post/events-editor";
import { PageHeader } from "@/components/ui/page-header";
import { listProjectEvents } from "@/lib/auto-post/queries";
import { getProject } from "@/lib/projects/queries";
import { toYmd } from "@/lib/time";

export const metadata: Metadata = { title: "お知らせ・季節の予定" };

// お知らせ・季節の予定（自動の投稿の「お知らせ・季節」の材料。docs/design/auto-post.md の 2.1）
export default async function AutoEventsPage(props: PageProps<"/projects/[id]/auto/events">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const events = await listProjectEvents(project.id);

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <Link href={`/projects/${project.id}/auto`} className="text-sm text-muted underline">
        ← 自動の投稿
      </Link>
      <PageHeader
        title="お知らせ・季節の予定"
        sub={events.length > 0 ? `${events.length} 件` : undefined}
        help={<>「お知らせ・季節」の自動の投稿は、その回の日付に近い予定を、前日と当日の 2 回まで知らせます。予定がない回は、季節のあいさつをします（飛ばすこともできます）。</>}
      />
      <EventsEditor projectId={project.id} initial={events} today={toYmd(new Date())} />
    </div>
  );
}
