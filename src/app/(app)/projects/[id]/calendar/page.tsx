import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PostChip, displayStatus, postWarning, snsSummary } from "@/components/posts/post-chip";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SuccessBanner } from "@/components/ui/feedback";
import { StatusMark } from "@/components/ui/marks";
import { listPostsBetween, listUndatedDrafts, postTitle, type PostRow } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import { addDays, dayOfMonth, formatTime, isYmd, monthOf, startOfYmd, toYmd, weekOf, weekdayLabel } from "@/lib/time";

export const metadata: Metadata = { title: "カレンダー" };

const DONE: Record<string, string> = {
  scheduled: "予約しました。",
  deleted: "投稿を削除しました。",
};

function rangeLabel(days: string[]) {
  const [first, last] = [days[0], days[6]];
  const end = monthOf(first) === monthOf(last) ? `${dayOfMonth(last)} 日` : `${monthOf(last)} 月 ${dayOfMonth(last)} 日`;
  return `${monthOf(first)} 月 ${dayOfMonth(first)} 日 – ${end}`;
}

export default async function CalendarPage(props: PageProps<"/projects/[id]/calendar">) {
  const [{ id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();

  const today = toYmd(new Date());
  const days = weekOf(isYmd(searchParams.week) ? searchParams.week : today);
  const [posts, undated] = await Promise.all([
    listPostsBetween(project.id, startOfYmd(days[0]).toISOString(), startOfYmd(addDays(days[6], 1)).toISOString()),
    listUndatedDrafts(project.id),
  ]);
  const byDay = new Map<string, PostRow[]>(days.map((d) => [d, []]));
  for (const p of posts) byDay.get(toYmd(new Date(p.planned_at!)))?.push(p);

  const base = `/projects/${project.id}`;
  const done = typeof searchParams.done === "string" ? DONE[searchParams.done] : undefined;
  const isThisWeek = days.includes(today);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-heading text-2xl font-bold">カレンダー</h1>
        <span className="text-base text-muted">{rangeLabel(days)}</span>
        <nav aria-label="週の切り替え" className="flex items-center gap-1 text-sm">
          <Link href={`${base}/calendar?week=${addDays(days[0], -7)}`} className="rounded-md px-2 py-1 text-primary hover:bg-primary-soft">
            ← 前の週
          </Link>
          {!isThisWeek && (
            <Link href={`${base}/calendar`} className="rounded-md px-2 py-1 text-primary hover:bg-primary-soft">
              今週
            </Link>
          )}
          <Link href={`${base}/calendar?week=${addDays(days[0], 7)}`} className="rounded-md px-2 py-1 text-primary hover:bg-primary-soft">
            次の週 →
          </Link>
        </nav>
        <div className="ml-auto flex gap-4 text-sm max-md:hidden">
          <span className="font-bold text-signal">● 予約</span>
          <span className="font-bold text-success">✓ 投稿済み</span>
          <span className="text-muted">○ 下書き</span>
        </div>
      </div>

      {done && <SuccessBanner>{done}</SuccessBanner>}

      {/* PC: 週の 7 列 */}
      <div className="grid min-h-[480px] grid-cols-7 overflow-hidden rounded-lg border border-border bg-surface max-md:hidden">
        {days.map((d, i) => {
          const isToday = d === today;
          const list = byDay.get(d) ?? [];
          return (
            <div key={d} className={`flex flex-col ${i < 6 ? "border-r border-line" : ""} ${isToday ? "bg-surface2" : ""}`}>
              <div
                className={`px-3 py-2.5 text-sm ${isToday ? "border-b-2 border-primary font-bold text-primary" : "border-b border-line text-muted"}`}
              >
                {dayOfMonth(d)} {weekdayLabel(d)}
                {isToday && " 今日"}
              </div>
              <div className="flex flex-col gap-2 p-2.5">
                {list.map((p) => (
                  <PostChip key={p.id} post={p} projectId={project.id} />
                ))}
              </div>
              <Link
                href={`${base}/compose?date=${d}`}
                className="group flex flex-1 items-start justify-center pt-2 text-xs text-muted hover:bg-primary-soft/50 hover:no-underline"
              >
                <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">＋ 投稿を足す</span>
                <span className="sr-only">
                  {monthOf(d)} 月 {dayOfMonth(d)} 日に投稿を足す
                </span>
              </Link>
            </div>
          );
        })}
      </div>

      {/* スマホ: 日付ごとの縦リスト */}
      <ol className="flex flex-col gap-3.5 md:hidden">
        {days.map((d) => {
          const isToday = d === today;
          const list = byDay.get(d) ?? [];
          return (
            <li key={d} className="flex flex-col gap-1.5">
              <p className={`text-xs font-bold ${isToday ? "text-primary" : "text-muted"}`}>
                {monthOf(d)}/{dayOfMonth(d)}（{weekdayLabel(d)}）{isToday && " 今日"}
              </p>
              {list.length === 0 ? (
                <Link
                  href={`${base}/compose?date=${d}`}
                  className="rounded-lg border-[1.5px] border-dashed border-border px-3.5 py-3 text-sm text-muted hover:no-underline"
                >
                  空いています ・ ＋ 投稿を足す
                </Link>
              ) : (
                list.map((p) => <MobilePostCard key={p.id} post={p} projectId={project.id} highlight={isToday} />)
              )}
            </li>
          );
        })}
      </ol>

      <p className="text-sm text-muted">空いている日を押すと、その日に投稿を足せます。</p>

      {undated.length > 0 && (
        <Card>
          <CardHeader title="日付のない下書き" />
          <ul>
            {undated.map((p) => (
              <li key={p.id} className="border-b border-line last:border-b-0">
                <Link
                  href={`${base}/posts/${p.id}`}
                  className="grid grid-cols-[1fr_auto] gap-3 px-5 py-3 text-[14px] hover:bg-surface2 hover:no-underline max-sm:px-4"
                >
                  <span className="truncate">{postTitle(p.body, 40)}</span>
                  <span className="text-sm text-muted">{snsSummary(p, true)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="md:hidden">
        <ButtonLink href={`${base}/compose`} className="w-full" size="lg">
          ＋ 投稿をつくる
        </ButtonLink>
      </div>
    </div>
  );
}

function MobilePostCard({ post, projectId, highlight }: { post: PostRow; projectId: string; highlight: boolean }) {
  const status = displayStatus(post);
  const warning = status === "draft" ? null : postWarning(post);
  return (
    <Link
      href={`/projects/${projectId}/posts/${post.id}`}
      className={`flex flex-col gap-1.5 rounded-lg bg-surface px-3.5 py-3 hover:no-underline ${highlight ? "border-[1.5px] border-primary" : status === "draft" ? "border border-dashed border-border" : "border border-border"}`}
    >
      <span className="flex justify-between gap-2 text-xs">
        <span className="text-muted">
          {post.planned_at ? formatTime(post.planned_at) : ""} ・ {snsSummary(post, true)}
        </span>
        <StatusMark status={status === "posted" ? "posted" : status} />
      </span>
      <span className="text-[14px]">{postTitle(post.body, 28)}</span>
      {warning && <span className="text-xs font-semibold text-signal">{warning}</span>}
    </Link>
  );
}
