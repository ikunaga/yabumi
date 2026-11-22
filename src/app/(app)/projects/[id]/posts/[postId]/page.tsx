import { LearningTip } from "@/components/learning/learning-tip";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { XSyncOnView } from "@/components/posts/x-sync-on-view";
import { PostCommentsSection } from "@/components/comments/comments";
import { MarkCommentsSeen } from "@/components/comments/mark-seen";
import { loadProjectComments } from "@/lib/sns/comments/queries";
import { aiConfigured } from "@/lib/ai/anthropic";
import { PostComposer } from "@/components/posts/post-composer";
import { readDefaultHashtags } from "@/lib/projects/default-hashtags";
import { PostNumbersBand } from "@/components/posts/post-numbers-band";
import { loadPostNumbers } from "@/lib/posts/numbers";
import { loadTimeTrends } from "@/lib/metrics/time-trends";
import { timeHintOf } from "@/lib/metrics/time-hint";
import { connectedAccountNames, connectedAccounts, getPost, postTitle } from "@/lib/posts/queries";
import { youtubeChoiceOf } from "@/lib/sns/youtube/consent";
import { tiktokSentAsDraft } from "@/lib/sns/tiktok/consent";
import { createAdminClient } from "@/lib/supabase/admin";
import { projectLinkBase } from "@/lib/links/domains";
import { getProject } from "@/lib/projects/queries";
import { loadProfileLinkInfo } from "@/lib/posts/profile-link-info";
import { isManualSns, manualComposeUrl, xComposeUrl, type SnsKey } from "@/lib/sns";
import { countSelfWrittenPosts, hasVoiceMemo } from "@/lib/plan/voice";
import { createClient } from "@/lib/supabase/server";
import { readRoundValues } from "@/lib/post-formats/series";
import { canPublish } from "@/lib/sns/adapters";
import { targetText } from "@/lib/sns/hashtags";
import { BY_HAND_TEXT, isByHand, type ByHandSns } from "@/lib/sns/by-hand";
import { getPlanHints } from "@/lib/plan/queries";
import { loadPostImageDownloads, loadPostImages, loadPostVideo, loadPostVideoDownload, snsNeedingImageReconnect } from "@/lib/media/queries";
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
  idea: { text: "ネタから下書きをつくりました。文面を確認して編集してから（【】で囲んだところがあれば、自分の言葉に書き換えてから）、予約か送信をしてください。", tone: "success" },
  note: { text: "ネタ帳のメモから下書きをつくりました。送り先と文面を確認して編集してから、予約か送信をしてください。", tone: "success" },
  note_images_skipped: { text: "ネタ帳のメモから下書きをつくりました。画像は、置ける合計か 1 つの投稿の枚数を超えるため、添えられなかったものがあります。", tone: "error" },
  idea_images_skipped: { text: "ネタから下書きをつくりました。メモの画像は、置ける合計か 1 つの投稿の枚数を超えるため、添えられなかったものがあります。", tone: "error" },
  sent: { text: "送信しました。", tone: "success" },
  sending: { text: "送信を始めました。少しして読み込み直すと結果が出ます。", tone: "success" },
  preparing: { text: "送信を始めました。画像は SNS 側の処理を待ってから送ります（1〜2 分ほど）。結果が出ると、この画面も変わります。", tone: "success" },
  send_failed: { text: "送れなかった SNS があります。下の「送信の結果」で理由を確認してください。", tone: "error" },
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
  // 送れなかった・手で投稿する TikTok は、利用者が画像を保存して TikTok のアプリから投稿する（保存の URL を作る）
  const tiktokByHandNeeded = post.targets.some((t) => t.sns === "tiktok" && t.status === "failed");
  const youtubeByHandNeeded = post.targets.some((t) => t.sns === "youtube" && t.status === "failed");
  const [accounts, planHints, { data: channels }, images, linkPreview, numbers, tiktokDownloads, postVideo, youtubeDownloads] = await Promise.all([
    connectedAccounts(project.id),
    getPlanHints(project.id),
    supabase.from("project_manual_channels").select("sns, profile_url").eq("project_id", project.id),
    loadPostImages(post.id),
    postLinkPreview(supabase, post.id),
    loadPostNumbers(project.id, { postId: post.id, sent }),
    tiktokByHandNeeded ? loadPostImageDownloads(post.id) : Promise.resolve([]),
    loadPostVideo(post.id),
    // 送れなかった・手で投稿する YouTube は、利用者が動画を保存して YouTube Studio から上げる（docs/design/youtube.md の 12.）
    youtubeByHandNeeded ? loadPostVideoDownload(post.id) : Promise.resolve([]),
  ]);
  // SNS のコメント（4.70）: 送った投稿だけ。数字の帯の下に出す
  const comments = sent ? (await loadProjectComments(project.id, { postId: post.id })).filter((p) => p.sns !== "x") : [];
  const timeHint = timeHintOf(await loadTimeTrends(project.id));
  const profileLink = await loadProfileLinkInfo(supabase, project);
  // ロードマップのタスクから作った投稿は、タスクの題と説明を手がかりとして出す（下書きから再開したときも。PMO2 の s8。RLS で本人のものだけ）
  // シリーズのフォーマットで本文に入れた回（投稿に結びついた記録のいちばん新しいもの）。③ のフォーマットの画像の絵の説明を埋める（docs/design/format-image.md の 2.1）
  const { data: round } = post.formatId
    ? await supabase.from("post_format_rounds").select("values").eq("post_id", post.id).eq("format_id", post.formatId).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const formatValues = round ? { values: readRoundValues(round.values) } : null;
  const roadmapItem = post.roadmapItemId
    ? ((await supabase.from("roadmap_items").select("id, title, detail").eq("id", post.roadmapItemId).eq("project_id", project.id).maybeSingle()).data ?? null)
    : null;
  // 自動の投稿でつくった投稿なら、その回と回し方（予約済みの投稿の詳細に「どこから来たか」と「この日の投稿を飛ばす」を出す。RLS で本人のものだけ）
  const { data: runRow } = await supabase.from("auto_runs").select("id, plan_id, status, due_at, auto_plans(name)").eq("post_id", post.id).maybeSingle();
  const autoRun = runRow ? { runId: runRow.id, planId: runRow.plan_id, planName: runRow.auto_plans?.name ?? "", status: runRow.status, dueAt: runRow.due_at } : null;
  // 「最初は自分で書く」のすすめに使う（docs/design/voice-from-posts.md の 3.4）
  const [selfWrittenPosts, voiceMemo, accountNames, linkBase] = await Promise.all([
    countSelfWrittenPosts(supabase, project.id),
    hasVoiceMemo(supabase, project.id),
    connectedAccountNames(project.id),
    projectLinkBase(supabase, project.id),
  ]);
  // 画像はあとから足すこともあるので、画像がなくても調べる
  const needImageReconnect = await snsNeedingImageReconnect(accounts);
  // YouTube に送るときに選んでいたもの（同意して保存した投稿を開き直したとき。サーバーだけが読める表なので、本人の投稿であることを確かめてから読む）
  const { data: claims } = await supabase.auth.getClaims();
  const youtubeChoice = post.targets.some((t) => t.sns === "youtube") && claims?.claims?.sub ? await youtubeChoiceOf(createAdminClient(), post.id, claims.claims.sub) : null;
  // TikTok を下書き（受信箱）として送ったか（送信の結果の札を分ける）。URL のない送信済みのときだけ読む
  const tiktokDraft =
    post.targets.some((t) => t.sns === "tiktok" && t.status === "published" && !t.external_url) && claims?.claims?.sub ? await tiktokSentAsDraft(createAdminClient(), post.id, claims.claims.sub) : false;
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
        // 下書きの投稿（飛ばした自動投稿・予約をやめた投稿）の確認待ちは、送らないので「確認待ち」と出さない。DB の状態は変えない
        // （確認待ちのまま残すので、あとで予約し直しても X などは確認してから送る）。1 回目の確認待ちの回の投稿は、確認待ちのまま
        status: t.status === "awaiting_approval" && post.status !== "scheduled" && runRow?.status !== "review" ? ("pending" as const) : t.status,
        externalUrl: t.external_url,
        // 「手動で投稿する」の印の文は DB の値なので、画面の文に置きかえる
        errorMessage: isByHand(t) ? BY_HAND_TEXT[t.sns as ByHandSns] : t.error_message,
        publishedAt: t.published_at,
        nextAttemptAt: t.next_attempt_at,
        manual: isManualSns(t.sns)
          ? { title: t.title, text: targetText(post.body, t), composeUrl: manualComposeUrl(t.sns, profileUrl(t.sns)) }
          : quoting(t)
            ? { title: null, text: targetText(post.body, t), composeUrl: xComposeUrl(targetText(post.body, t), `https://x.com/i/web/status/${t.quote_post_id}`) }
            : undefined,
        // 引用の X（X の API では引用を送れないので、X の画面で送って記録する。4.52）
        quote: quoting(t),
        // 送れなかった X は、手で投稿して記録できる（月の上限・クレジット切れのとき。決定 D16）。
        // TikTok も、手で投稿するを選んだとき・送れなかったときは、TikTok のアプリで投稿して記録できる（docs/design/tiktok.md の 17.。写真の投稿をウェブで開く窓口はない）
        fallback:
          t.sns === "x" && t.status === "failed"
            ? { title: null, text: targetText(post.body, t), composeUrl: xComposeUrl(targetText(post.body, t)) }
            : t.sns === "tiktok" && t.status === "failed"
              ? { title: t.title, text: targetText(post.body, t), composeUrl: null, downloads: tiktokDownloads }
              : // YouTube も、手動で投稿するを選んだとき・送れなかったときは、YouTube Studio で投稿して記録できる（docs/design/youtube.md の 12.）。
                t.sns === "youtube" && t.status === "failed"
                ? { title: t.title, text: targetText(post.body, t), composeUrl: "https://studio.youtube.com/", downloads: youtubeDownloads }
                : undefined,
        postedByHand: t.status === "published" && !t.external_post_id,
        tiktokDraft: t.sns === "tiktok" && tiktokDraft,
        byHand: isByHand(t),
        removedOnSns: t.status === "deleted" && Boolean(t.sns_removed_at),
      },
    ]),
  );
  // 準備中の帯は、準備中の SNS に合わせる（TikTok は TikTok の側で写真を取りに来て処理する。docs/design/tiktok.md の 6.）
  const preparingSns = post.targets.filter((t) => t.status === "preparing").map((t) => t.sns);
  const notice =
    String(searchParams.done) === "preparing" && preparingSns.includes("tiktok")
      ? preparingSns.every((s) => s === "tiktok")
        ? { text: "送信を始めました。TikTok で処理しています（数分かかることがあります）。結果が出ると、この画面も変わります。", tone: "success" as const }
        : { text: "送信を始めました。画像は SNS 側の処理を待ってから送ります（数分かかることがあります）。結果が出ると、この画面も変わります。", tone: "success" as const }
      : String(searchParams.done) === "preparing" && postVideo.video
        ? // YouTube は yabumi から何回かに分けて動画を上げる（docs/design/youtube.md の 3.）。ほかの SNS は SNS の側で動画を処理する
          preparingSns.length > 0 && preparingSns.every((s) => s === "youtube")
          ? { text: "送信を始めました。YouTube に動画を上げています（数分かかることがあります）。結果が出ると、この画面も変わります。", tone: "success" as const }
          : preparingSns.includes("youtube")
            ? { text: "送信を始めました。YouTube に動画を上げ、ほかの SNS は動画を処理しています（数分かかることがあります）。結果が出ると、この画面も変わります。", tone: "success" as const }
            : { text: "送信を始めました。動画は SNS が処理しています（数分かかることがあります）。結果が出ると、この画面も変わります。", tone: "success" as const }
        : NOTICES[String(searchParams.done)];
  // 送ったあと（送信を始めた・送った・手で投稿したと記録した）の「ひとこと」（4.47。1 日 1 回まで）
  const sentTip = ["sent", "sending", "preparing", "manual_posted"].includes(String(searchParams.done));

  // X に送った（または手で投稿して記録した）ものがあれば、画面を開いたあとに X にまだあるかを確かめる
  const hasPublishedX = post.targets.some((t) => t.sns === "x" && t.status === "published");

  return (
    <>
      {hasPublishedX && <XSyncOnView projectId={project.id} postId={post.id} />}
      {comments.length > 0 && <MarkCommentsSeen projectId={project.id} postId={post.id} />}
      {autoRun && (
        <Link href={`/projects/${project.id}/auto/${autoRun.planId}`} className="mb-3 inline-block text-sm text-muted underline">
          ← 自動投稿に戻る
        </Link>
      )}
      <PostComposer
      defaultHashtags={readDefaultHashtags(project.default_hashtags)}
      key={post.id}
      projectId={project.id}
      projectName={project.name}
      postId={post.id}
      savedStatus={post.status}
      autoRun={autoRun}
      connected={(Object.keys(accounts) as SnsKey[]).filter(canPublish)}
      planHints={planHints}
      afterNotice={sentTip ? <LearningTip trigger="post_sent" /> : null}
      aiCheckEnabled={aiConfigured()}
      results={results}
      needImageReconnect={needImageReconnect}
      linkPreview={linkPreview}
      numbers={
        (numbers || comments.length > 0) && (
          <div className="flex flex-col gap-4">
            {numbers && <PostNumbersBand projectId={project.id} numbers={numbers} />}
            <PostCommentsSection posts={comments} now={new Date()} />
          </div>
        )
      }
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
        video: postVideo.video,
        videoRemoved: postVideo.removed,
        shortLinks,
        quotePostId: post.targets.find((t) => t.sns === "x" && t.status === "pending")?.quote_post_id ?? null,
        textOrigin: post.textOrigin,
        // 下書きから再開したときに、選んでいたフォーマットと「タスクから」の手がかりを戻す（PMO2 の s8）
        formatId: post.formatId,
        formatValues,
        roadmapItem,
        youtube: youtubeChoice,
      }}
    />
    </>
  );
}
