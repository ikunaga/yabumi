import { LearningTip } from "@/components/learning/learning-tip";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { XSyncOnView } from "@/components/posts/x-sync-on-view";
import { aiConfigured } from "@/lib/ai/anthropic";
import { PostComposer } from "@/components/posts/post-composer";
import { PostNumbersBand } from "@/components/posts/post-numbers-band";
import { loadPostNumbers } from "@/lib/posts/numbers";
import { loadTimeTrends } from "@/lib/metrics/time-trends";
import { timeHintOf } from "@/lib/metrics/time-hint";
import { connectedAccountNames, connectedAccounts, getPost, postTitle } from "@/lib/posts/queries";
import { projectLinkBase } from "@/lib/links/domains";
import { getProject } from "@/lib/projects/queries";
import { loadProfileLinkInfo } from "@/lib/posts/profile-link-info";
import { isManualSns, manualComposeUrl, xComposeUrl, type SnsKey } from "@/lib/sns";
import { countSelfWrittenPosts, hasVoiceMemo } from "@/lib/plan/voice";
import { createClient } from "@/lib/supabase/server";
import { canPublish } from "@/lib/sns/adapters";
import { targetText } from "@/lib/sns/hashtags";
import { X_BY_HAND_MESSAGE } from "@/lib/sns/x/send-rules";
import { getPlanHints } from "@/lib/plan/queries";
import { loadPostImages, snsNeedingImageReconnect } from "@/lib/media/queries";
import { postLinkPreview } from "@/lib/links/store";
import { findLinkableUrls } from "@/lib/links/rules";
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
  idea: { text: "ネタから下書きをつくりました。文面を確かめて直してから（【】で囲んだところがあれば、自分の言葉に書き換えてから）、予約か送信をしてください。", tone: "success" },
  note: { text: "ネタ帳のメモから下書きをつくりました。送り先と文面を確かめて直してから、予約か送信をしてください。", tone: "success" },
  note_images_skipped: { text: "ネタ帳のメモから下書きをつくりました。画像は、置ける合計か 1 つの投稿の枚数を超えるため、添えられなかったものがあります。", tone: "error" },
  idea_images_skipped: { text: "ネタから下書きをつくりました。メモの画像は、置ける合計か 1 つの投稿の枚数を超えるため、添えられなかったものがあります。", tone: "error" },
  sent: { text: "送信しました。", tone: "success" },
  sending: { text: "送信を始めました。少しして読み込み直すと結果が出ます。", tone: "success" },
  preparing: { text: "送信を始めました。画像は SNS 側の処理を待ってから送ります（1〜2 分ほど）。少しして読み込み直すと結果が出ます。", tone: "success" },
  send_failed: { text: "送れなかった SNS があります。下の「送信の結果」で理由を確かめてください。", tone: "error" },
  deleted_sns: { text: "SNS から取り消しました。yabumi の下書きは残っています。", tone: "success" },
  manual_posted: { text: "投稿したことを記録しました。", tone: "success" },
  removed_on_sns: { text: "SNS で消したことを記録しました。消えた投稿へのリンクは、yabumi からも消しました。", tone: "success" },
};

export default async function EditPostPage(props: PageProps<"/projects/[id]/posts/[postId]">) {
  const [{ id, postId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  if (!isUuid(postId)) notFound();
  const [project, post] = await Promise.all([getProject(id), getPost(id, postId)]);
  if (!project || !post) notFound();
  const supabase = await createClient();
  // 送った投稿ならその投稿の数字、まだならば前回送った投稿の数字
  const sent = post.targets.some((t) => ["published", "preparing", "publishing", "deleted"].includes(t.status));
  const [accounts, planHints, { data: channels }, images, linkPreview, numbers] = await Promise.all([
    connectedAccounts(project.id),
    getPlanHints(project.id),
    supabase.from("project_manual_channels").select("sns, profile_url").eq("project_id", project.id),
    loadPostImages(post.id),
    postLinkPreview(supabase, post.id),
    loadPostNumbers(project.id, { postId: post.id, sent }),
  ]);
  const timeHint = timeHintOf(await loadTimeTrends(project.id));
  const profileLink = await loadProfileLinkInfo(supabase, project);
  // 「最初は自分で書く」のすすめに使う（docs/design/voice-from-posts.md の 3.4）
  const [selfWrittenPosts, voiceMemo, accountNames, linkBase] = await Promise.all([
    countSelfWrittenPosts(supabase, project.id),
    hasVoiceMemo(supabase, project.id),
    connectedAccountNames(project.id),
    projectLinkBase(supabase, project.id),
  ]);
  // 画像はあとから足すこともあるので、画像がなくても調べる
  const needImageReconnect = await snsNeedingImageReconnect(accounts);
  // 短縮リンクのチェックの状態: 本文に URL があるのに、送る前の配信先に短縮リンクがなければ、オフで保存したもの
  const hasUrl = [post.body, ...post.targets.map((t) => t.body_override ?? "")].some((t) => findLinkableUrls(t).length > 0);
  const shortLinks = !hasUrl || Object.keys(linkPreview).length > 0 || !post.targets.some((t) => t.status === "pending");
  const quoting = (t: (typeof post.targets)[number]) => t.sns === "x" && t.status === "pending" && Boolean(t.quote_post_id);
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
          ? { title: t.title, text: targetText(post.body, t), composeUrl: manualComposeUrl(t.sns, profileUrl(t.sns)) }
          : quoting(t)
            ? { title: null, text: targetText(post.body, t), composeUrl: xComposeUrl(targetText(post.body, t), `https://x.com/i/web/status/${t.quote_post_id}`) }
            : undefined,
        // 引用の X（X の API では引用を送れないので、X の画面で送って記録する。4.52）
        quote: quoting(t),
        // 送れなかった X は、手で投稿して記録できる（月の上限・クレジット切れのとき。決定 D16）
        fallback:
          t.sns === "x" && t.status === "failed"
            ? { title: null, text: targetText(post.body, t), composeUrl: xComposeUrl(targetText(post.body, t)) }
            : undefined,
        postedByHand: t.status === "published" && !t.external_post_id,
        byHand: t.sns === "x" && t.status === "failed" && t.error_message === X_BY_HAND_MESSAGE,
        removedOnSns: t.status === "deleted" && Boolean(t.sns_removed_at),
      },
    ]),
  );
  const notice = NOTICES[String(searchParams.done)];
  // 送ったあと（送信を始めた・送った・手で投稿したと記録した）の「ひとこと」（4.47。1 日 1 回まで）
  const sentTip = ["sent", "sending", "preparing", "manual_posted"].includes(String(searchParams.done));

  // X に送った（または手で投稿して記録した）ものがあれば、画面を開いたあとに X にまだあるかを確かめる
  const hasPublishedX = post.targets.some((t) => t.sns === "x" && t.status === "published");

  return (
    <>
      {hasPublishedX && <XSyncOnView projectId={project.id} postId={post.id} />}
      <PostComposer
      key={post.id}
      projectId={project.id}
      projectName={project.name}
      postId={post.id}
      connected={(Object.keys(accounts) as SnsKey[]).filter(canPublish)}
      planHints={planHints}
      afterNotice={sentTip ? <LearningTip trigger="post_sent" /> : null}
      aiCheckEnabled={aiConfigured()}
      results={results}
      needImageReconnect={needImageReconnect}
      linkPreview={linkPreview}
      numbers={numbers && <PostNumbersBand projectId={project.id} numbers={numbers} />}
      timeHint={timeHint}
      profileLink={profileLink}
      selfWrittenPosts={selfWrittenPosts}
      hasVoiceMemo={voiceMemo}
      accountNames={accountNames}
      linkBase={linkBase}
      notice={notice?.text}
      noticeTone={notice?.tone}
      initial={{
        body: post.body,
        targets: post.targets.map((t) => ({ sns: t.sns, bodyOverride: t.body_override, title: t.title, hashtags: t.hashtags })),
        plannedAt: toInputValue(post.planned_at),
        images,
        shortLinks,
        quotePostId: post.targets.find((t) => t.sns === "x" && t.status === "pending")?.quote_post_id ?? null,
        textOrigin: post.textOrigin,
      }}
    />
    </>
  );
}
