import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { scheduleText } from "@/components/auto-post/format";
import { PauseAllButton } from "@/components/auto-post/plan-controls";
import { PlanStatusMark } from "@/components/auto-post/status-mark";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { SuccessBanner } from "@/components/ui/feedback";
import { SnsTag } from "@/components/ui/marks";
import { PageHeader } from "@/components/ui/page-header";
import { KIND_LABELS } from "@/lib/auto-post/labels";
import { getAutoPostHold, listAutoPlans, listAutoReviewItems, listUpcomingAutoRuns } from "@/lib/auto-post/queries";
import { MAX_AUTO_PLANS } from "@/lib/auto-post/schema";
import type { SnsKey } from "@/lib/sns";
import { SNS } from "@/lib/sns";
import { getProject } from "@/lib/projects/queries";
import { formatShort } from "@/lib/time";

export const metadata: Metadata = { title: "自動の投稿" };

const DAY_MS = 86_400_000;

// 自動の投稿の一覧（docs/design/auto-post.md の 1.6・1.7）。上に確かめ待ちと次の回、下に回し方ごとに 1 行。
// 入口は「…」（その他）・概要の帯・カレンダー（投稿をつくるには置かない。2026-11-18 オーナーの指示）
export default async function AutoListPage(props: PageProps<"/projects/[id]/auto">) {
  const [{ id }, { started }] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const now = new Date();
  const [plans, reviews, upcoming, hold] = await Promise.all([
    listAutoPlans(project.id),
    listAutoReviewItems(project.id),
    listUpcomingAutoRuns(project.id, now, new Date(now.getTime() + 30 * DAY_MS)),
    getAutoPostHold(),
  ]);
  const base = `/projects/${project.id}/auto`;
  const next = upcoming[0] ?? null;
  const nextOf = new Map<string, string>();
  for (const u of upcoming) if (!nextOf.has(u.planId)) nextOf.set(u.planId, u.dueAt);
  const active = plans.filter((p) => p.status === "active").length;
  const full = plans.length >= MAX_AUTO_PLANS;
  const firstReview = reviews.find((r) => r.kind === "first_review");

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title="自動の投稿"
        sub={plans.length > 0 ? (hold ? `${plans.length} 件・運営者が止めています` : `${plans.length} 件・動いている ${active} 件`) : undefined}
        help={
          <>
            決めた間隔で、AI が投稿の文を作って予約します。送る 24 時間前にカレンダーと通知でお知らせするので、気になれば直す・飛ばす・止めるができます。X
            は送る前にあなたが中身を確かめ、押したものだけ送ります。
          </>
        }
        actions={
          <>
            {hold ? (
              // 運営者が止めている間は始められない（理由と問い合わせ先は上の帯）
              <Button type="button" disabled className="max-sm:w-full">
                ＋ 自動の投稿をはじめる
              </Button>
            ) : full ? (
              <span className="text-sm text-muted">{MAX_AUTO_PLANS} 件までです</span>
            ) : (
              <ButtonLink href={`${base}/new`} className="max-sm:w-full">
                ＋ 自動の投稿をはじめる
              </ButtonLink>
            )}
            {plans.length > 0 && <PauseAllButton projectId={project.id} activeCount={active} held={hold !== null} />}
          </>
        }
      />
      {started === "1" && (
        <SuccessBanner>
          自動の投稿をはじめました。
          {firstReview ? "最初の回ができたら、送る前に確かめてください。" : "最初の回ができたら、通知でお知らせします。"}
        </SuccessBanner>
      )}

      {reviews.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 max-sm:px-4">
          <p className="text-[16px] font-bold">
            <span className="text-signal" aria-hidden="true">
              ●{" "}
            </span>
            確かめ待ち <span className="num">{reviews.length}</span> 件
            <span className="ml-2 text-sm font-normal text-muted">
              {firstReview ? `最初の回を確かめてください（${formatShort(firstReview.dueAt)} まで）` : `次は ${formatShort(reviews[0].dueAt)} まで`}
            </span>
          </p>
          <ButtonLink href={`${base}/review`} size="sm" className="max-sm:w-full">
            確かめる
          </ButtonLink>
        </Card>
      )}

      {/* 運営者が止めている間は回を作らないので、次の回は出さない（上の帯で知らせる） */}
      {next && !hold && (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 max-sm:px-4">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="num text-[18px] font-bold">次は {formatShort(next.dueAt)}</p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
              {next.planName}
              {next.sns.map((s) => (
                <SnsTag key={s} sns={s} />
              ))}
            </p>
          </div>
          <ButtonLink href={next.postId ? `/projects/${project.id}/posts/${next.postId}` : `${base}/${next.planId}`} variant="secondary" size="sm" className="max-sm:w-full">
            その回を見る
          </ButtonLink>
        </Card>
      )}

      <Card className="overflow-hidden">
        {plans.length === 0 ? (
          <EmptyState
            title="まだ自動の投稿はありません"
            description="「何を」「どこに」「どのくらい」を選ぶだけで始められます。"
            action={<ButtonLink href={`${base}/new`}>自動の投稿をはじめる</ButtonLink>}
          />
        ) : (
          <ul className="divide-y divide-border">
            {plans.map((p) => {
              const sns = Object.keys(p.targets) as SnsKey[];
              const nextAt = p.status === "active" && !hold ? nextOf.get(p.id) : undefined;
              return (
                <li key={p.id}>
                  <Link href={`${base}/${p.id}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4 text-fg hover:bg-subtle hover:no-underline max-sm:px-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-[16px] font-bold">{p.name}</span>
                        <PlanStatusMark plan={p} held={hold !== null} />
                      </p>
                      <p className="num flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
                        <span>{KIND_LABELS[p.kind]}</span>
                        <span aria-hidden="true">・</span>
                        <span>{scheduleText(p.schedule)}</span>
                        {sns.map((s) => (
                          <span key={s} className="sr-only">
                            {SNS[s].label}
                          </span>
                        ))}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="flex gap-1" aria-hidden="true">
                        {sns.map((s) => (
                          <SnsTag key={s} sns={s} />
                        ))}
                      </span>
                      <span className="num text-sm text-muted">{nextAt ? `次 ${formatShort(nextAt)}` : p.status === "active" && !hold ? "次の回はまだ" : ""}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-sm text-muted">
        <Link href={`${base}/events`} className="underline">
          お知らせ・季節の予定
        </Link>
        （「お知らせ・季節」の自動の投稿の材料）
      </p>
    </div>
  );
}
