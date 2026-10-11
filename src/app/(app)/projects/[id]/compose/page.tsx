import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aiConfigured } from "@/lib/ai/anthropic";
import { PostComposer } from "@/components/posts/post-composer";
import { connectedAccounts } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { canPublish } from "@/lib/sns/adapters";
import { getPlanHints } from "@/lib/plan/queries";
import { snsNeedingImageReconnect } from "@/lib/media/queries";
import { isYmd } from "@/lib/time";

export const metadata: Metadata = { title: "投稿をつくる" };

// 新しい投稿。カレンダーで日付を押して来たときは ?date=YYYY-MM-DD がつく
export default async function ComposePage(props: PageProps<"/projects/[id]/compose">) {
  const [{ id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const [accounts, planHints] = await Promise.all([connectedAccounts(project.id), getPlanHints(project.id)]);
  const date = isYmd(searchParams.date) ? searchParams.date : null;
  const needImageReconnect = await snsNeedingImageReconnect(accounts);
  // 送り先の最初の印は、つないで送れる SNS だけに付ける（つないでいなければ印なし。作成画面で「先に SNS をつなぐ」を出す）
  const connected = (Object.keys(accounts) as SnsKey[]).filter(canPublish);

  return (
    <PostComposer
      projectId={project.id}
      projectName={project.name}
      postId={null}
      connected={connected}
      planHints={planHints}
      needImageReconnect={needImageReconnect}
      aiCheckEnabled={aiConfigured()}
      initial={{
        body: "",
        targets: SNS_KEYS.filter((s) => connected.includes(s)).map((sns) => ({ sns, bodyOverride: null })),
        plannedAt: date ? `${date}T12:00` : "",
      }}
    />
  );
}
