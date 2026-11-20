import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormatsScreen } from "@/components/formats/formats-screen";
import { PhotoTemplateManager } from "@/components/formats/photo-template-manager";
import { chipClass } from "@/components/ui/chip";
import { PageHeader } from "@/components/ui/page-header";
import { aiConfigured } from "@/lib/ai/anthropic";
import { readFormatsBack } from "@/lib/post-formats/back";
import { getPlanHints } from "@/lib/plan/queries";
import { connectedAccounts } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import type { SnsKey } from "@/lib/sns";

export const metadata: Metadata = { title: "フォーマット" };

// フォーマットの画面（More の Formats。2026-11-18 オーナーの了承。docs/design/post-formats.md の 4）。
// 投稿のフォーマット（投稿をつくるの「フォーマットから」で使う）と、絵の説明のフォーマット（画像の欄で使う）をタブで分ける。
// 前は投稿をつくるの中に畳んだ「フォーマットを管理」があった
export default async function FormatsPage(props: PageProps<"/projects/[id]/formats">) {
  const [{ id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const tab = searchParams.tab === "photo" ? "photo" : "post";
  // 自動の投稿の「画像」から来たときは、戻るリンクを出し、タブを替えても持ち回る
  const back = readFormatsBack(project.id, searchParams.back);
  const keep = back && typeof searchParams.back === "string" ? `back=${encodeURIComponent(searchParams.back)}` : "";
  const base = `/projects/${project.id}/formats`;

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title="フォーマット"
        actions={
          back && (
            <Link href={back.href} className="text-sm underline">
              ← {back.label}
            </Link>
          )
        }
      />
      <nav aria-label="フォーマットの種類" className="flex flex-wrap gap-2">
        <Link href={keep ? `${base}?${keep}` : base} aria-current={tab === "post" ? "page" : undefined} className={`${chipClass({ on: tab === "post" })} hover:no-underline`}>
          投稿の文
        </Link>
        <Link href={`${base}?tab=photo${keep ? `&${keep}` : ""}`} aria-current={tab === "photo" ? "page" : undefined} className={`${chipClass({ on: tab === "photo" })} hover:no-underline`}>
          絵の説明
        </Link>
      </nav>
      <section className="rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
        {tab === "post" ? <PostTab projectId={project.id} /> : <PhotoTemplateManager projectId={project.id} />}
      </section>
    </div>
  );
}

async function PostTab({ projectId }: { projectId: string }) {
  const [accounts, planHints] = await Promise.all([connectedAccounts(projectId), getPlanHints(projectId)]);
  return (
    <FormatsScreen
      projectId={projectId}
      pillars={(planHints?.pillars ?? []).map((p) => p.name).filter(Boolean)}
      planHashtags={planHints?.hashtags ?? []}
      connected={Object.keys(accounts) as SnsKey[]}
      aiEnabled={aiConfigured()}
    />
  );
}
