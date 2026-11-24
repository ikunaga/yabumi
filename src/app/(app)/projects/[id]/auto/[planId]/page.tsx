import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { scheduleText } from "@/components/auto-post/format";
import { PlanControls } from "@/components/auto-post/plan-controls";
import { PlanSample } from "@/components/auto-post/plan-sample";
import { PlanStatusMark } from "@/components/auto-post/status-mark";
import { ReviewFlow } from "@/components/auto-post/review-why";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { DisclosureBox } from "@/components/ui/disclosure";
import { SuccessBanner } from "@/components/ui/feedback";
import { SnsTag } from "@/components/ui/marks";
import { Metric } from "@/components/ui/metric";
import { autoImageLabel, errorRunText, EXPIRED_TARGET_LABEL, kindSummary, RUN_REASON_TEXT, RUN_STATUS_LABELS, TARGET_MODE_LABELS } from "@/lib/auto-post/labels";
import { getAutoPlan, getAutoPostHold, listAutoRuns, listUpcomingAutoRuns } from "@/lib/auto-post/queries";
import type { AutoImage, AutoRun } from "@/lib/auto-post/types";
import { formatsBackHref } from "@/lib/post-formats/back";
import type { SnsKey } from "@/lib/sns";
import { loadRunResults, loadSeriesFormatImage, type RunTargetResult } from "@/lib/auto-post/ui-queries";
import { getProject } from "@/lib/projects/queries";
import { formatShort, formatTime, toYmd } from "@/lib/time";
import { dayWithWeekday } from "@/lib/posts/send-mode";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "自動投稿" };

const DAY_MS = 86_400_000;

// 回し方の画面（docs/design/auto-post.md の 1.6・1.7）。上に数字 3 つ、下に回の一覧、横（スマホは上）に操作
export default async function AutoPlanPage(props: PageProps<"/projects/[id]/auto/[planId]">) {
  const [{ id, planId }, { saved, from: savedFrom, skipped, post: skippedPost }] = await Promise.all([props.params, props.searchParams]);
  const [project, plan] = await Promise.all([getProject(id), getAutoPlan(planId)]);
  if (!project || !plan || plan.projectId !== project.id) notFound();
  const now = new Date();
  const [runs, upcoming, hold, seriesFormat] = await Promise.all([
    listAutoRuns(plan.id, 50),
    listUpcomingAutoRuns(project.id, now, new Date(now.getTime() + 90 * DAY_MS)),
    getAutoPostHold(),
    plan.kind === "series" && plan.materials.format_id ? loadSeriesFormatImage(project.id, plan.materials.format_id) : Promise.resolve(null),
  ]);
  const results = await loadRunResults(runs.flatMap((r) => (r.postId ? [r.postId] : [])));
  const next = upcoming.find((u) => u.planId === plan.id) ?? null;

  const past = runs.filter((r) => new Date(r.dueAt) <= now || ["held", "skipped", "canceled"].includes(r.status));
  const sentRuns = past.filter((r) => r.postId && (results.get(r.postId) ?? []).some((t) => t.status === "published"));
  const heldCount = runs.filter((r) => r.status === "held").length;
  const views = sentRuns.flatMap((r) => (results.get(r.postId!) ?? []).map((t) => t.views)).filter((v): v is number => v !== null);
  const avgViews = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / sentRuns.length) : null;
  const sns = Object.keys(plan.targets) as SnsKey[];
  const base = `/projects/${project.id}`;
  const reviewSns = sns.filter((s) => plan.targets[s] === "review");

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <div className="flex flex-col gap-3">
        <Link href={`${base}/auto`} className="text-sm text-muted underline">
          ← 自動投稿
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="flex flex-wrap items-center gap-x-3 text-[28px] leading-tight font-bold max-sm:text-[24px]">
              {plan.name}
              <PlanStatusMark plan={plan} held={hold !== null} />
            </h1>
            <p className="num text-[15px] text-faint">{hold && plan.status === "active" ? "新しい投稿はつくられません" : next ? `次は ${formatShort(next.dueAt)}` : plan.status === "active" ? "次の投稿はまだありません" : "止めています"}</p>
          </div>
          <PlanControls projectId={project.id} planId={plan.id} status={plan.status} nextLabel={next && !hold ? formatShort(next.dueAt) : null} held={hold !== null} formatChanged={plan.stopReason === "format_changed"} />
        </div>
      </div>
      {typeof skipped === "string" && !Number.isNaN(Date.parse(skipped)) && (
        // 予約済みの投稿の詳細で「この日の投稿を飛ばす」を押したあと（2026-11-21 PM の指摘）
        <SuccessBanner>
          {dayWithWeekday(toYmd(new Date(skipped)))}
          {formatTime(skipped)} の投稿を飛ばしました。{next && !hold ? `次の投稿は ${formatShort(next.dueAt)} です。` : ""}
          {typeof skippedPost === "string" && isUuid(skippedPost) && (
            <>
              {" "}
              <Link href={`/projects/${project.id}/posts/${skippedPost}`} className="font-bold underline">
                飛ばした投稿を見る →
              </Link>
            </>
          )}
        </SuccessBanner>
      )}
      {saved === "1" && (
        // いつの投稿から新しい設定になるか（保存のポップアップと同じ。もう作った投稿は前の設定のまま送る。2026-11-21 オーナー）
        <SuccessBanner>
          {typeof savedFrom === "string" && !Number.isNaN(Date.parse(savedFrom)) ? `保存しました。${formatShort(savedFrom)} の投稿から、新しい設定になります。` : "保存しました。次の投稿から、新しい設定になります。"}
        </SuccessBanner>
      )}

      <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-3 max-sm:gap-2">
        <Metric label="送信済み" value={sentRuns.length} unit="本" className="max-sm:px-3" />
        <Metric label={
            <>
              <span className="max-sm:hidden">下書きに残した</span>
              <span className="sm:hidden">下書き</span>
            </>
          } value={heldCount} unit="件" className="max-sm:px-3" />
        <Metric
          label={
            <>
              <span className="max-sm:hidden">見られた数の平均</span>
              <span className="sm:hidden">見られた数</span>
            </>
          }
          value={avgViews ?? "—"}
          note={avgViews === null ? "まだありません" : <span className="sm:hidden">1 本の平均</span>}
          className="max-sm:px-3"
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="これからの投稿と送信済みの投稿" />
        {runs.length === 0 ? (
          <EmptyState description={next ? `1 回目の投稿は ${formatShort(next.dueAt)} です。送る 24 時間前に作ります。` : "まだ投稿はありません。"} />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} results={r.postId ? (results.get(r.postId) ?? []) : []} projectId={project.id} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="px-6 py-5 max-sm:px-4 max-sm:py-4">
        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-[15px] max-sm:grid-cols-[5rem_1fr]">
          <dt className="text-muted">何を</dt>
          <dd>{kindSummary(plan.kind, seriesFormat?.name)}</dd>
          <dt className="text-muted">どこに</dt>
          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {sns.map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <SnsTag sns={s} />
                <span className="text-sm text-muted">{TARGET_MODE_LABELS[plan.targets[s]!]}</span>
              </span>
            ))}
            {plan.targets.x && <span className="text-sm text-muted">{plan.xLink === "always" ? "X にはリンクを付けます" : "X にはリンクを付けません"}</span>}
            {reviewSns.length > 0 && <ReviewFlow sns={reviewSns} />}
          </dd>
          <dt className="text-muted">いつ送るか</dt>
          <dd className="num">
            {scheduleText(plan.schedule)} に送ります。投稿の文は、送る {plan.leadHours} 時間前にできあがります
          </dd>
          <dt className="text-muted">画像</dt>
          <dd>
            <PlanImage projectId={project.id} planId={plan.id} image={plan.image} format={seriesFormat} />
          </dd>
          {plan.instructions.length > 0 && (
            <>
              <dt className="text-muted">書き方</dt>
              <dd>{plan.instructions.join("・")}</dd>
            </>
          )}
        </dl>
      </Card>

      {/* 見本を見ながら書き方を直す（運営者が止めている間・運営者が止めた回し方では出さない。作るのも DB が断る） */}
      {!hold && plan.stopReason !== "operator" && <PlanSample plan={plan} />}
    </div>
  );
}

// 「画像」の行。シリーズは、フォーマットの画像の設定に合わせて出し分ける（ウィザードの「画像」の欄と同じ。2026-11-20 オーナーの指摘）
function PlanImage({ projectId, planId, image, format }: { projectId: string; planId: string; image: AutoImage | null; format: Awaited<ReturnType<typeof loadSeriesFormatImage>> }) {
  if (!format) return <>{autoImageLabel(image)}</>;
  const formatsHref = formatsBackHref(projectId, { kind: "plan", planId });
  if (!format.hasImage)
    return (
      <span className="flex flex-col gap-0.5">
        <span>{autoImageLabel(image)}</span>
        <span className="text-sm text-muted">
          フォーマットでは、画像を決めていません。{" "}
          <Link href={formatsHref} className="whitespace-nowrap underline">
            フォーマットで画像を決める →
          </Link>
        </span>
      </span>
    );
  // 前に保存した設定が、いまのフォーマットと合わない（フォーマットにあとから画像・見出しを足した）ときは、いま保存されているとおりに出し、編集を促す
  const matched = image?.source === "format" && (image.headline === "format") === format.hasHeadline;
  if (!matched)
    return (
      <span className="flex flex-col gap-0.5">
        <span>{autoImageLabel(image)}</span>
        <span className="text-sm text-muted">
          いまの画像の設定は、フォーマット「{format.name}」と違います。この設定を編集して保存すると、フォーマットのとおりにつくります。{" "}
          <Link href={`/projects/${projectId}/auto/${planId}/edit`} className="whitespace-nowrap underline">
            設定を編集する →
          </Link>
        </span>
      </span>
    );
  return (
    <span className="flex flex-col gap-0.5">
      <span>画像{format.hasHeadline ? "と、画像に重ねる文字" : ""}は、フォーマット「{format.name}」で決めたとおりにつくります。</span>
      {format.imageSpec && <span className="num text-sm text-muted">{format.imageSpec}</span>}
      <Link href={formatsHref} className="self-start text-sm underline">
        フォーマットを編集 →
      </Link>
    </span>
  );
}

function RunRow({ run, results, projectId }: { run: AutoRun; results: RunTargetResult[]; projectId: string }) {
  const published = results.filter((t) => t.status === "published");
  const failed = results.some((t) => t.status === "failed");
  const expired = results.filter((t) => t.expired);
  const label = published.length ? "送信済み" : failed ? "送れなかった" : run.status === "canceled" && run.reason === "user_skipped" ? "飛ばした" : RUN_STATUS_LABELS[run.status];
  const tone = published.length ? "success" : failed || run.status === "held" || run.status === "review" ? "signal" : "neutral";
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3.5 max-sm:px-4">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num text-[15px] font-bold">{formatShort(run.dueAt)}</span>
          <Badge tone={tone}>{label}</Badge>
        </p>
        <RunReason run={run} />
        {expired.map((t) => (
          <p key={t.sns} className="flex flex-wrap items-center gap-x-1.5 text-[14px] text-muted">
            <SnsTag sns={t.sns} />
            {EXPIRED_TARGET_LABEL}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {published.map((t) => (
          <span key={t.sns} className="num inline-flex items-center gap-1 text-sm text-muted">
            <SnsTag sns={t.sns} />
            {t.views ?? "—"}
          </span>
        ))}
        {run.postId && (
          <Link href={`/projects/${projectId}/posts/${run.postId}`} className="text-sm font-bold underline">
            見る
          </Link>
        )}
      </div>
    </li>
  );
}

// 回の理由（reason の文と reason_detail）。確かめずに時刻を過ぎた最初の回は reason が user_skipped でも利用者が飛ばしたのではないので、reason_detail だけを出す。
// reason_detail が長いとき（AI の枠の上限の文など）は、reason の文だけを出して、くわしくは畳む
const DETAIL_INLINE_MAX = 40;
function RunReason({ run }: { run: AutoRun }) {
  if (!run.reason) return null;
  const detail = run.reasonDetail?.trim() || null;
  if (run.reason === "user_skipped" && detail) return <p className="text-[14px] text-muted">{detail}</p>;
  // 作れなかった回: 理由の文（例外の種類など）は運営者が原因を追うためのものなので出さず、利用者向けの続きの文を出す（2026-11-24）
  if (run.reason === "error")
    return (
      <p className="text-[14px] text-muted">{errorRunText(detail)}</p>
    );
  if (detail && [...detail].length > DETAIL_INLINE_MAX)
    return (
      <div className="flex flex-col gap-0.5 text-[14px] text-muted">
        <p>{RUN_REASON_TEXT[run.reason]}</p>
        <DisclosureBox label="くわしい理由を表示" size="sm">{detail}</DisclosureBox>
      </div>
    );
  return (
    <p className="text-[14px] text-muted">
      {RUN_REASON_TEXT[run.reason]}
      {detail && `（${detail}）`}
    </p>
  );
}
