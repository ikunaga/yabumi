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
import { getProject } from "@/lib/projects/queries";
import { formatShort, formatTime, toYmd, weekdayLabel } from "@/lib/time";

export const metadata: Metadata = { title: "自動投稿" };

const DAY_MS = 86_400_000;

// 「11/21（土）21:00」
function dueText(iso: string): string {
  const ymd = toYmd(new Date(iso));
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}（${weekdayLabel(ymd)}）${formatTime(iso)}`;
}

// 自動の投稿の一覧（docs/design/auto-post.md の 1.6・1.7）。上に確認待ちの帯、「これからの投稿」（設定ごとに次の 1 件）、「自動投稿の設定」（設定ごとのカード）
// 入口は「…」（その他）・概要の帯・カレンダー（投稿をつくるには置かない。2026-11-18 オーナーの指示）
export default async function AutoListPage(props: PageProps<"/projects/[id]/auto">) {
  const [{ id }, { started, sample }] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const now = new Date();
  const [plans, reviews, upcoming, hold] = await Promise.all([
    listAutoPlans(project.id),
    listAutoReviewItems(project.id, { media: false }),
    listUpcomingAutoRuns(project.id, now, new Date(now.getTime() + 30 * DAY_MS)),
    getAutoPostHold(),
  ]);
  const base = `/projects/${project.id}/auto`;
  // 設定ごとに次の 1 件（upcoming は日時の順）
  const seen = new Set<string>();
  const nextRuns = upcoming.filter((u) => !seen.has(u.planId) && seen.add(u.planId));
  const active = plans.filter((p) => p.status === "active").length;
  const full = plans.length >= MAX_AUTO_PLANS;
  const firstReview = reviews.find((r) => r.kind === "first_review");

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title="自動投稿"
        sub={plans.length > 0 ? (hold ? `${plans.length} 件・運営者が止めています` : `${plans.length} 件・運用中 ${active} 件`) : undefined}
        help={
          <>
            決めた間隔で、AI が投稿の文を作って予約します。送る 24 時間前にカレンダーと通知でお知らせするので、気になれば編集・飛ばす・止めるができます。X
            は送る前にあなたが中身を確認し、押したものだけ送ります。
          </>
        }
        actions={
          <>
            {hold ? (
              // 運営者が止めている間は始められない（理由と問い合わせ先は上の帯）
              <Button type="button" disabled className="max-sm:w-full">
                ＋ 自動投稿をはじめる
              </Button>
            ) : full ? (
              <span className="text-sm text-muted">{MAX_AUTO_PLANS} 件までです</span>
            ) : (
              <ButtonLink href={`${base}/new`} className="max-sm:w-full">
                ＋ 自動投稿をはじめる
              </ButtonLink>
            )}
          </>
        }
      />
      {started === "1" && (
        <SuccessBanner>
          自動投稿をはじめました。
          {sample === "used"
            ? "テストでつくった投稿を 1 回目として送ります。"
            : sample === "failed"
              ? "テストでつくった投稿は、1 回目に使えませんでした。"
              : ""}
          {sample === "used" ? "" : firstReview ? "1 回目の投稿ができたら、送る前に確認してください。" : "1 回目の投稿ができたら、通知でお知らせします。"}
        </SuccessBanner>
      )}

      {/* 確認待ちがあるときだけ、朱の印の帯 */}
      {reviews.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-4 py-3">
          <p className="text-[15px] font-bold">
            <span className="text-signal">● 確認待ち</span> <span className="num">{reviews.length}</span> 件
            {firstReview && <span className="ml-2 text-sm font-normal text-muted">{formatShort(firstReview.dueAt)} までに確認してください</span>}
          </p>
          <Link href={`${base}/review`} className="text-sm font-bold">
            確認する →
          </Link>
        </div>
      )}

      {/* これからの投稿: 設定ごとに次の 1 件。枠のある 1 つの箱に、区切り線で並べる（2026-11-21 オーナーの意見「セクションを分ける」）。
          運営者が止めている間は作らないので出さない（上の帯で知らせる） */}
      {plans.length > 0 && !hold && (
        <section className="flex flex-col gap-2" aria-labelledby="auto-upcoming">
          <h2 id="auto-upcoming" className="text-[18px] font-bold max-sm:text-[16px]">
            これからの投稿
          </h2>
          {nextRuns.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">送る予定の投稿はまだありません。</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-line bg-surface">
              {nextRuns.map((u) => (
                <li key={u.runId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="num text-[15px] font-bold">{dueText(u.dueAt)}</p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                      <span>{u.planName}</span>
                      {u.sns.map((s) => (
                        <SnsTag key={s} sns={s} />
                      ))}
                    </p>
                  </div>
                  <Link href={u.postId ? `/projects/${project.id}/posts/${u.postId}` : `${base}/${u.planId}`} className="text-sm font-bold">
                    投稿を見る →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 自動投稿の設定: 設定ごとのカード。押すと設定の画面へ */}
      <section className="flex flex-col gap-2" aria-labelledby="auto-plans">
        <h2 id="auto-plans" className="text-[18px] font-bold max-sm:text-[16px]">
          自動投稿の設定{plans.length > 0 && <span className="num ml-1 text-[15px] font-normal text-muted">{plans.length} 件</span>}
        </h2>
        {plans.length === 0 ? (
          <Card>
            <EmptyState
              title="まだ自動投稿はありません"
              description="「何を」「どこに」「どのくらい」を選ぶだけで始められます。"
              action={<ButtonLink href={`${base}/new`}>自動投稿をはじめる</ButtonLink>}
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {plans.map((p) => {
              const sns = Object.keys(p.targets) as SnsKey[];
              return (
                <li key={p.id}>
                  <Link href={`${base}/${p.id}`} className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-5 py-4 text-fg hover:bg-subtle hover:no-underline max-sm:px-4">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[16px] font-bold">{p.name}</span>
                      <PlanStatusMark plan={p} held={hold !== null} />
                    </p>
                    <p className="num text-[14px] text-muted">
                      {KIND_LABELS[p.kind]}・{scheduleText(p.schedule)}
                    </p>
                    <p className="flex flex-wrap gap-1">
                      {sns.map((s) => (
                        <SnsTag key={s} sns={s} />
                      ))}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {/* 全部止めるは、押すと全部が止まるので小さく、設定の並びの下に置く */}
        {plans.length > 0 && (
          <div className="flex justify-end">
            <PauseAllButton projectId={project.id} activeCount={active} held={hold !== null} />
          </div>
        )}
      </section>

      <p className="text-sm">
        <Link href={`${base}/events`} className="font-bold">
          お知らせと季節の予定を登録する →
        </Link>
      </p>
    </div>
  );
}
