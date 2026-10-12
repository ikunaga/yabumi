import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { MonthGrid } from "@/components/calendar/month-grid";
import { MonthMobile } from "@/components/calendar/month-mobile";
import type { MonthDay } from "@/components/calendar/month-types";
import { CalendarViewSwitch } from "@/components/calendar/view-switch";
import { PostChip, displayStatus, postWarning, snsSummary } from "@/components/posts/post-chip";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SuccessBanner } from "@/components/ui/feedback";
import { StatusMark } from "@/components/ui/marks";
import { countPostsByDay, listPostsBetween, listUndatedDrafts, postTitle, type PostRow } from "@/lib/posts/queries";
import { CALENDAR_VIEW_COOKIE, resolveCalendarView } from "@/lib/calendar-view";
import { getProject } from "@/lib/projects/queries";
import { addDays, addMonths, dayOfMonth, formatTime, isYm, isYmd, monthGrid, monthOf, startOfYmd, toYmd, weekOf, weekdayLabel, ymOf } from "@/lib/time";

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
  const base = `/projects/${project.id}`;
  const done = typeof searchParams.done === "string" ? DONE[searchParams.done] : undefined;
  // 表示は URL に持つ（?view=week&week=YYYY-MM-DD / ?view=month&month=YYYY-MM）。指定がなければ、最後に選んだ表示（cookie）、それもなければ週
  const view = resolveCalendarView(searchParams, (await cookies()).get(CALENDAR_VIEW_COOKIE)?.value);
  if (view === "month") {
    const ym = isYm(searchParams.month) ? searchParams.month : ymOf(today);
    return <MonthView projectId={project.id} base={base} ym={ym} today={today} done={done} />;
  }

  const days = weekOf(isYmd(searchParams.week) ? searchParams.week : today);
  const [posts, undated] = await Promise.all([
    listPostsBetween(project.id, startOfYmd(days[0]).toISOString(), startOfYmd(addDays(days[6], 1)).toISOString()),
    listUndatedDrafts(project.id),
  ]);
  const byDay = new Map<string, PostRow[]>(days.map((d) => [d, []]));
  for (const p of posts) byDay.get(toYmd(new Date(p.planned_at!)))?.push(p);

  const isThisWeek = days.includes(today);
  // 月に切り替えるときは、今週なら今月、ほかの週はその週の木曜の月（週の多くの日がある月）
  const monthHref = `${base}/calendar?view=month&month=${ymOf(isThisWeek ? today : days[3])}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-heading text-2xl font-bold">カレンダー</h1>
        <CalendarViewSwitch current="week" weekHref={`${base}/calendar?view=week&week=${days[0]}`} monthHref={monthHref} />
        <span className="text-base text-muted">{rangeLabel(days)}</span>
        <nav aria-label="週の切り替え" className="flex items-center gap-1 text-sm">
          <Link href={`${base}/calendar?view=week&week=${addDays(days[0], -7)}`} className="rounded-md px-2 py-1 text-primary hover:bg-primary-soft">
            ← 前の週
          </Link>
          {!isThisWeek && (
            <Link href={`${base}/calendar?view=week`} className="rounded-md px-2 py-1 text-primary hover:bg-primary-soft">
              今週
            </Link>
          )}
          <Link href={`${base}/calendar?view=week&week=${addDays(days[0], 7)}`} className="rounded-md px-2 py-1 text-primary hover:bg-primary-soft">
            次の週 →
          </Link>
        </nav>
        <Legend />
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
                <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">＋ 投稿をつくる</span>
                <span className="sr-only">
                  {monthOf(d)} 月 {dayOfMonth(d)} 日に投稿をつくる
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
                  空いています ・ ＋ 投稿をつくる
                </Link>
              ) : (
                list.map((p) => <MobilePostCard key={p.id} post={p} projectId={project.id} highlight={isToday} />)
              )}
            </li>
          );
        })}
      </ol>

      <p className="text-sm text-muted">空いている日を押すと、その日の投稿をつくれます。</p>

      <UndatedDrafts posts={undated} base={base} />

      <MobileComposeButton base={base} />
    </div>
  );
}

function Legend() {
  return (
    <div className="ml-auto flex gap-4 text-sm max-md:hidden">
      <span className="font-bold text-signal">● 予約</span>
      <span className="font-bold text-success">✓ 投稿済み</span>
      <span className="text-muted">○ 下書き</span>
    </div>
  );
}

function UndatedDrafts({ posts: undated, base }: { posts: PostRow[]; base: string }) {
  return (
    <>
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
    </>
  );
}

function MobileComposeButton({ base }: { base: string }) {
  return (
    <div className="md:hidden">
      <ButtonLink href={`${base}/compose`} className="w-full" size="lg">
        ＋ 投稿をつくる
      </ButtonLink>
    </div>
  );
}

// 月の表示（F06）。6 週分の投稿を一度に読み、日ごとの数は DB で数える（読む行には上限があるので、行を数えない）
const MONTH_POST_LIMIT = 500;

async function MonthView({ projectId, base, ym, today, done }: { projectId: string; base: string; ym: string; today: string; done?: string }) {
  const grid = monthGrid(ym);
  const [from, to] = [startOfYmd(grid[0]).toISOString(), startOfYmd(addDays(grid[41], 1)).toISOString()];
  const [posts, counts, undated] = await Promise.all([listPostsBetween(projectId, from, to, MONTH_POST_LIMIT), countPostsByDay(projectId, from, to), listUndatedDrafts(projectId)]);

  const items = new Map<string, MonthDay["items"]>(grid.map((d) => [d, []]));
  for (const p of posts) {
    const status = displayStatus(p);
    items.get(toYmd(new Date(p.planned_at!)))?.push({
      id: p.id,
      href: `${base}/posts/${p.id}`,
      time: formatTime(p.planned_at!),
      sns: snsSummary(p, true),
      title: postTitle(p.body, 28),
      status,
      warning: status === "draft" ? null : postWarning(p),
    });
  }
  const days: MonthDay[] = grid.map((d) => {
    const list = items.get(d) ?? [];
    return { ymd: d, day: dayOfMonth(d), inMonth: ymOf(d) === ym, isToday: d === today, count: Math.max(counts.get(d) ?? 0, list.length), items: list };
  });
  const isThisMonth = ym === ymOf(today);
  // 週に切り替えるときは、今月なら今週、ほかの月はその月の 1 日の週
  const weekHref = isThisMonth ? `${base}/calendar?view=week` : `${base}/calendar?view=week&week=${ym}-01`;
  const monthLink = (m: string) => `${base}/calendar?view=month&month=${m}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-heading text-2xl font-bold">カレンダー</h1>
        <CalendarViewSwitch current="month" weekHref={weekHref} monthHref={monthLink(ym)} />
        <span className="text-base text-muted">
          {ym.slice(0, 4)} 年 {Number(ym.slice(5, 7))} 月
        </span>
        <nav aria-label="月の切り替え" className="flex items-center gap-1 text-sm">
          <Link href={monthLink(addMonths(ym, -1))} className="rounded-md px-2 py-1 text-primary hover:bg-primary-soft">
            ← 前の月
          </Link>
          {!isThisMonth && (
            <Link href={monthLink(ymOf(today))} className="rounded-md px-2 py-1 text-primary hover:bg-primary-soft">
              今日
            </Link>
          )}
          <Link href={monthLink(addMonths(ym, 1))} className="rounded-md px-2 py-1 text-primary hover:bg-primary-soft">
            次の月 →
          </Link>
        </nav>
        <Legend />
      </div>

      {done && <SuccessBanner>{done}</SuccessBanner>}

      <div className="max-md:hidden">
        <MonthGrid days={days} base={base} />
      </div>
      <div className="md:hidden">
        <MonthMobile key={ym} days={days} base={base} initial={isThisMonth ? today : `${ym}-01`} />
      </div>

      <p className="text-sm text-muted max-md:hidden">空いている日を押すと、その日の投稿をつくれます。日付を押すと、その日の週を見られます。</p>
      <p className="text-sm text-muted md:hidden">日付を押すと、その日の投稿が下に出ます。</p>

      <UndatedDrafts posts={undated} base={base} />

      <MobileComposeButton base={base} />
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
