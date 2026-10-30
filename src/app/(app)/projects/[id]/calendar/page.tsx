import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { MonthGrid } from "@/components/calendar/month-grid";
import { MonthMobile } from "@/components/calendar/month-mobile";
import type { MonthDay } from "@/components/calendar/month-types";
import { TodoButton, WeekBandView } from "@/components/calendar/roadmap-band";
import { CalendarViewSwitch } from "@/components/calendar/view-switch";
import { loadCalendarRoadmap, type CalendarTodo } from "@/lib/calendar/roadmap";
import { displayStatus, postWarning, snsSummary } from "@/components/posts/post-chip";
import { CalendarSide } from "@/components/calendar/calendar-side";
import { TimeTrendsCard } from "@/components/calendar/time-trends-card";
import { WeekGrid } from "@/components/calendar/week-grid";
import { chipClass } from "@/components/ui/chip";
import { Metric } from "@/components/ui/metric";
import { loadCalendarStats, type CalendarStats } from "@/lib/calendar/stats";
import { loadCoachView } from "@/lib/coach/load";
import { loadTimeTrends } from "@/lib/metrics/time-trends";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SuccessBanner } from "@/components/ui/feedback";
import { SnsMark, StatusMark } from "@/components/ui/marks";
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
  const isThisWeek = days.includes(today);
  // 数字と右の列は、今週なら今月、ほかの週はその週の木曜の月（週の多くの日がある月）
  const ym = ymOf(isThisWeek ? today : days[3]);
  const [posts, undated, bands, stats, upcoming, side] = await Promise.all([
    listPostsBetween(project.id, startOfYmd(days[0]).toISOString(), startOfYmd(addDays(days[6], 1)).toISOString()),
    listUndatedDrafts(project.id),
    loadCalendarRoadmap(project.id, [days[0]], today),
    loadCalendarStats(project.id, ym),
    listUpcoming(project.id),
    loadSide(project.id),
  ]);
  const band = bands.get(days[0]);
  const todosByDay = plannedTodos(band ? [band] : []);
  const byDay = new Map<string, PostRow[]>(days.map((d) => [d, []]));
  for (const p of posts) byDay.get(toYmd(new Date(p.planned_at!)))?.push(p);

  const monthHref = `${base}/calendar?view=month&month=${ym}`;

  return (
    <div className="flex flex-col gap-4">
      <Header
        switcher={<CalendarViewSwitch current="week" weekHref={`${base}/calendar?view=week&week=${days[0]}`} monthHref={monthHref} />}
        label={rangeLabel(days)}
        nav={[
          { href: `${base}/calendar?view=week&week=${addDays(days[0], -7)}`, label: "← 前の週" },
          ...(isThisWeek ? [] : [{ href: `${base}/calendar?view=week`, label: "今週" }]),
          { href: `${base}/calendar?view=week&week=${addDays(days[0], 7)}`, label: "次の週 →" },
        ]}
        navLabel="週の切り替え"
      />

      {done && <SuccessBanner>{done}</SuccessBanner>}

      <StatCards stats={stats} month={Number(ym.slice(5, 7))} />

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4 max-xl:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          {/* PC: 時刻 × 曜日のマス目（上にロードマップのやることと週の目標の帯） */}
          {band && (band.todos.length > 0 || band.goals.length > 0) && (
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <WeekBandView band={band} base={base} today={today} />
            </div>
          )}
          <div className="max-md:hidden">
            <WeekGrid days={days} today={today} posts={posts} todosByDay={todosByDay} base={base} />
          </div>

          {/* スマホ: 日付ごとの縦リスト */}
          <ol className="flex flex-col gap-3.5 md:hidden">
            {days.map((d) => {
              const isToday = d === today;
              const list = byDay.get(d) ?? [];
              return (
                <li key={d} className="flex flex-col gap-1.5">
                  <p className={`text-[13px] font-bold ${isToday ? "text-fg" : "text-muted"}`}>
                    {monthOf(d)}/{dayOfMonth(d)}（{weekdayLabel(d)}）{isToday && " 今日"}
                  </p>
                  {(todosByDay.get(d) ?? []).map((t) => (
                    <TodoButton key={t.id} todo={t} base={base} variant="day" />
                  ))}
                  {list.length === 0 ? (
                    <Link href={`${base}/compose?date=${d}`} className="rounded-md border border-dashed border-input px-3.5 py-2.5 text-[13px] text-faint hover:no-underline">
                      ＋ 投稿をつくる
                    </Link>
                  ) : (
                    list.map((p) => <MobilePostCard key={p.id} post={p} projectId={project.id} highlight={isToday} />)
                  )}
                </li>
              );
            })}
          </ol>

          <TimeTrendsCard trends={side.trends} />
          <UndatedDrafts posts={undated} base={base} />
        </div>
        <CalendarSide stats={stats} month={Number(ym.slice(5, 7))} upcoming={upcoming} base={base} week={side.week} />
      </div>

      <MobileComposeButton base={base} />
    </div>
  );
}

// 見出しの行: 見出し・週と月の切り替え・期間・前後への移動・凡例
function Header({ switcher, label, nav, navLabel }: { switcher: ReactNode; label: string; nav: { href: string; label: string }[]; navLabel: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="text-[26px] font-bold max-sm:text-[22px]">カレンダー</h1>
      {switcher}
      <span className="num text-[16px] text-muted">{label}</span>
      <nav aria-label={navLabel} className="flex items-center gap-1.5">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className={`${chipClass()} hover:no-underline`}>
            {n.label}
          </Link>
        ))}
      </nav>
      <Legend />
    </div>
  );
}

// 上の数字のカード（見本 C の上の 4 つ）。いまあるもの（予約・投稿済み・下書き・送れなかった）だけ
function StatCards({ stats, month }: { stats: CalendarStats; month: number }) {
  return (
    <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:gap-2.5">
      <Metric label={`${month} 月の予約`} value={stats.scheduled} unit="件" />
      <Metric label={`${month} 月の投稿済み`} value={stats.posted} unit="件" />
      <Metric label="下書き" value={stats.drafts} unit="件" />
      <Metric label="送れなかった" value={<span className={stats.failed > 0 ? "text-danger" : ""}>{stats.failed}</span>} unit="件" />
    </div>
  );
}

// 右の列の今週の空き枠（伴走と同じ計算。週の回数を決めていなければ null）と、時間帯の傾向
async function loadSide(projectId: string) {
  const supabase = await createClient();
  const [coach, trends] = await Promise.all([loadCoachView(supabase, projectId), loadTimeTrends(projectId, supabase)]);
  return { week: coach?.week ?? null, trends };
}

// 次の予約（これから 60 日の予約のうち、近い 3 件）
async function listUpcoming(projectId: string): Promise<PostRow[]> {
  const now = new Date();
  const until = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const posts = await listPostsBetween(projectId, now.toISOString(), until.toISOString(), 20);
  return posts.filter((p) => displayStatus(p) === "scheduled").slice(0, 3);
}

function Legend() {
  return (
    <div className="ml-auto flex gap-4 text-[13px] text-muted max-md:hidden">
      <span className="font-bold text-success">✓ 投稿済み</span>
      <span className="font-bold text-danger">! 失敗</span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-4 rounded-sm border border-dashed border-input" />
        下書き
      </span>
    </div>
  );
}

function UndatedDrafts({ posts: undated, base }: { posts: PostRow[]; base: string }) {
  return (
    <>
      {undated.length > 0 && (
        <Card>
          <CardHeader title="日付のない下書き" action={`${undated.length} 件`} />
          <ul>
            {undated.map((p) => (
              <li key={p.id} className="border-b border-line last:border-b-0">
                <Link
                  href={`${base}/posts/${p.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-6 py-3 text-[15px] hover:bg-surface2 hover:no-underline max-sm:px-4"
                >
                  <span className="truncate">{postTitle(p.body, 40)}</span>
                  <span className="flex gap-1">
                    {p.targets.map((t) => (
                      <SnsMark key={t.id} sns={t.sns} />
                    ))}
                  </span>
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
  const weekStarts = Array.from({ length: grid.length / 7 }, (_, i) => grid[i * 7]);
  const [posts, counts, undated, bandMap, stats, upcoming, side] = await Promise.all([
    listPostsBetween(projectId, from, to, MONTH_POST_LIMIT),
    countPostsByDay(projectId, from, to),
    listUndatedDrafts(projectId),
    loadCalendarRoadmap(projectId, weekStarts, today),
    loadCalendarStats(projectId, ym),
    listUpcoming(projectId),
    loadSide(projectId),
  ]);
  const bands = weekStarts.map((w) => bandMap.get(w));
  const todosByDay = plannedTodos([...bandMap.values()]);

  const items = new Map<string, MonthDay["items"]>(grid.map((d) => [d, []]));
  for (const p of posts) {
    const status = displayStatus(p);
    items.get(toYmd(new Date(p.planned_at!)))?.push({
      id: p.id,
      href: `${base}/posts/${p.id}`,
      time: formatTime(p.planned_at!),
      sns: snsSummary(p, true),
      snsKeys: p.targets.map((t) => t.sns),
      title: postTitle(p.body, 28),
      status,
      warning: status === "draft" ? null : postWarning(p),
    });
  }
  const days: MonthDay[] = grid.map((d) => {
    const list = items.get(d) ?? [];
    return { ymd: d, day: dayOfMonth(d), inMonth: ymOf(d) === ym, isToday: d === today, count: Math.max(counts.get(d) ?? 0, list.length), items: list, todos: todosByDay.get(d) ?? [] };
  });
  const isThisMonth = ym === ymOf(today);
  // 週に切り替えるときは、今月なら今週、ほかの月はその月の 1 日の週
  const weekHref = isThisMonth ? `${base}/calendar?view=week` : `${base}/calendar?view=week&week=${ym}-01`;
  const monthLink = (m: string) => `${base}/calendar?view=month&month=${m}`;
  const month = Number(ym.slice(5, 7));

  return (
    <div className="flex flex-col gap-4">
      <Header
        switcher={<CalendarViewSwitch current="month" weekHref={weekHref} monthHref={monthLink(ym)} />}
        label={`${ym.slice(0, 4)} 年 ${month} 月`}
        nav={[
          { href: monthLink(addMonths(ym, -1)), label: "← 前の月" },
          ...(isThisMonth ? [] : [{ href: monthLink(ymOf(today)), label: "今月" }]),
          { href: monthLink(addMonths(ym, 1)), label: "次の月 →" },
        ]}
        navLabel="月の切り替え"
      />

      {done && <SuccessBanner>{done}</SuccessBanner>}

      <StatCards stats={stats} month={month} />

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4 max-xl:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="max-md:hidden">
            <MonthGrid days={days} base={base} bands={bands} today={today} />
          </div>
          <div className="md:hidden">
            <MonthMobile key={ym} days={days} base={base} initial={isThisMonth ? today : `${ym}-01`} bands={bands} today={today} />
          </div>
          <TimeTrendsCard trends={side.trends} />
          <UndatedDrafts posts={undated} base={base} />
        </div>
        <CalendarSide stats={stats} month={month} upcoming={upcoming} base={base} week={side.week} />
      </div>

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
      className={`flex flex-col gap-1.5 rounded-md bg-surface px-3.5 py-3 hover:no-underline ${highlight ? "border border-primary" : status === "draft" ? "border border-dashed border-input" : "border border-border"}`}
    >
      <span className="flex items-center gap-1.5 text-[13px]">
        <span className="num text-faint">{post.planned_at ? formatTime(post.planned_at) : ""}</span>
        {post.targets.map((t) => (
          <SnsMark key={t.id} sns={t.sns} />
        ))}
        <span className="ml-auto">
          <StatusMark status={status} />
        </span>
      </span>
      <span className="text-[15px]">{postTitle(post.body, 28)}</span>
      {warning && <span className="text-[13px] font-semibold text-signal">{warning}</span>}
    </Link>
  );
}

// 予定日のあるやることを、日ごとに
function plannedTodos(bands: { todos: CalendarTodo[] }[]): Map<string, CalendarTodo[]> {
  const out = new Map<string, CalendarTodo[]>();
  for (const b of bands) for (const t of b.todos) if (t.plannedOn) out.set(t.plannedOn, [...(out.get(t.plannedOn) ?? []), t]);
  return out;
}
