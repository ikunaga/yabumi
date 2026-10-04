import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostComposer } from "@/components/posts/post-composer";
import { connectedAccounts, getPost, postTitle } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import { isManualSns, manualComposeUrl, type SnsKey } from "@/lib/sns";
import { createClient } from "@/lib/supabase/server";
import { canPublish } from "@/lib/sns/adapters";
import { getPlanHints } from "@/lib/plan/queries";
import type { TargetResult } from "@/components/posts/send-results";
import { toInputValue } from "@/lib/time";
import { isUuid } from "@/lib/uuid";

export async function generateMetadata(props: PageProps<"/projects/[id]/posts/[postId]">): Promise<Metadata> {
  const { id, postId } = await props.params;
  const post = isUuid(postId) ? await getPost(id, postId) : null;
  return { title: post ? postTitle(post.body, 16) : "投稿" };
}

const NOTICES: Record<string, { text: string; tone: "success" | "error" }> = {
  saved: { text: "下書きを保存しました。", tone: "success" },
  sent: { text: "送信しました。", tone: "success" },
  sending: { text: "送信を始めました。少しして読み込み直すと結果が出ます。", tone: "success" },
  send_failed: { text: "送れなかった SNS があります。右の「送信の結果」で理由を確かめてください。", tone: "error" },
  deleted_sns: { text: "SNS から取り消しました。矢書の下書きは残っています。", tone: "success" },
  manual_posted: { text: "投稿したことを記録しました。", tone: "success" },
};

export default async function EditPostPage(props: PageProps<"/projects/[id]/posts/[postId]">) {
  const [{ id, postId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  if (!isUuid(postId)) notFound();
  const [project, post] = await Promise.all([getProject(id), getPost(id, postId)]);
  if (!project || !post) notFound();
  const supabase = await createClient();
  const [accounts, planHints, { data: channels }] = await Promise.all([
    connectedAccounts(project.id),
    getPlanHints(project.id),
    supabase.from("project_manual_channels").select("sns, profile_url").eq("project_id", project.id),
  ]);
  const profileUrl = (sns: SnsKey) => channels?.find((c) => c.sns === sns)?.profile_url ?? null;
  const results: Partial<Record<SnsKey, TargetResult>> = Object.fromEntries(
    post.targets.map((t) => [
      t.sns,
      {
        id: t.id,
        status: t.status,
        externalUrl: t.external_url,
        errorMessage: t.error_message,
        publishedAt: t.published_at,
        nextAttemptAt: t.next_attempt_at,
        manual: isManualSns(t.sns)
          ? { title: t.title, text: t.body_override ?? post.body, composeUrl: manualComposeUrl(t.sns, profileUrl(t.sns)) }
          : undefined,
      },
    ]),
  );
  const notice = NOTICES[String(searchParams.done)];

  return (
    <PostComposer
      key={post.id}
      projectId={project.id}
      projectName={project.name}
      postId={post.id}
      connected={(Object.keys(accounts) as SnsKey[]).filter(canPublish)}
      planHints={planHints}
      results={results}
      notice={notice?.text}
      noticeTone={notice?.tone}
      initial={{
        body: post.body,
        targets: post.targets.map((t) => ({ sns: t.sns, bodyOverride: t.body_override, title: t.title })),
        plannedAt: toInputValue(post.planned_at),
      }}
    />
  );
}
