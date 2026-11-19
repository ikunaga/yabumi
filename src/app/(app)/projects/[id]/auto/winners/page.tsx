import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WinnersScreen } from "@/components/auto-post/winners-screen";
import { PageHeader } from "@/components/ui/page-header";
import { aiConfigured } from "@/lib/ai/anthropic";
import { getAutoPostHold } from "@/lib/auto-post/queries";
import { loadWinners } from "@/lib/metrics/winners-queries";
import { getPlanHints } from "@/lib/plan/queries";
import { connectedAccounts } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import type { SnsKey } from "@/lib/sns";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "伸びた投稿から" };

// 伸びた投稿から、フォーマットと自動の回し方をつくる（docs/design/winning-posts.md の 5.）。
// 判定は決まりで（AI なし）。AI を呼ぶのは「型の案を作る」を押したときだけ。保存も、自動の投稿を始めるのも、利用者が押したときだけ
export default async function WinnersPage(props: PageProps<"/projects/[id]/auto/winners">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const [view, accounts, hints, hold] = await Promise.all([loadWinners(await createClient(), project.id), connectedAccounts(project.id), getPlanHints(project.id), getAutoPostHold()]);
  const base = `/projects/${project.id}`;
  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <Link href={`${base}/auto`} className="text-sm text-muted">
        ← 自動の投稿
      </Link>
      <PageHeader
        title="伸びた投稿から"
        help={
          <>
            同じ SNS の、この 90 日の投稿のまん中の数（中央値）と比べて、1.5 倍以上{view.metric === "clicks" ? "押された" : "見られた"}投稿を出します。送って 7
            日たった投稿だけを見ます。X の数字は使いません（X の決まりで、X から読んだ数字を AI の会社に渡せるか確かめられないため）。
          </>
        }
      />
      <WinnersScreen
        projectId={project.id}
        view={view}
        pillars={(hints?.pillars ?? []).map((p) => p.name).filter(Boolean)}
        planHashtags={hints?.hashtags ?? []}
        connected={Object.keys(accounts) as SnsKey[]}
        aiEnabled={aiConfigured()}
        held={hold !== null}
      />
    </div>
  );
}
