import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormatsScreen } from "@/components/formats/formats-screen";
import { aiConfigured } from "@/lib/ai/anthropic";
import { readFormatsBack } from "@/lib/post-formats/back";
import { getPlanHints } from "@/lib/plan/queries";
import { connectedAccounts } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import type { SnsKey } from "@/lib/sns";

export const metadata: Metadata = { title: "フォーマット" };

// フォーマットの画面（More の Formats。2026-11-18 オーナーの了承。docs/design/post-formats.md の 4）。
// 前は投稿をつくるの中に畳んだ「フォーマットを管理」があった。絵の説明のフォーマットのタブは、2026-11-21 オーナーの決定でなくした
// （画像の作り方は、フォーマットの画像の設定に一本化。古い ?tab=photo のリンクは、ふつうの一覧を出す）
export default async function FormatsPage(props: PageProps<"/projects/[id]/formats">) {
  const [{ id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  // 自動の投稿の「画像」から来たときは、戻るリンクを出す
  const back = readFormatsBack(project.id, searchParams.back);

  const [accounts, planHints] = await Promise.all([connectedAccounts(project.id), getPlanHints(project.id)]);
  // 見出し（件数と「＋ 新しいフォーマット」）は、件数を読む画面の側で出す（一覧・編集・新しく作るで見出しが変わる）
  return (
    <FormatsScreen
      projectId={project.id}
      pillars={(planHints?.pillars ?? []).map((p) => p.name).filter(Boolean)}
      planHashtags={planHints?.hashtags ?? []}
      connected={Object.keys(accounts) as SnsKey[]}
      aiEnabled={aiConfigured()}
      back={back ? { href: back.href, label: back.label } : null}
    />
  );
}
