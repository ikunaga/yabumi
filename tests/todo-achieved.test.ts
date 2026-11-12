// 数字の目標に届いたやることは「達成」（済みと同じに数える。DB の status は書き換えず、読むときに決める。オーナーの指摘 2026-11-03）
import { describe, expect, it } from "vitest";
import { toCalendarTodo } from "@/lib/calendar/roadmap-view";
import { overdueItems, thisWeekCounts, thisWeekTodos, type RoadmapItem, type RoadmapView } from "@/lib/roadmap/load";
import { effectiveStatus, itemProgress } from "@/lib/roadmap/schema";

const WEEK = "2026-11-02";
const item = (over: Partial<RoadmapItem>): RoadmapItem => ({
  id: "i",
  title: "やること",
  kind: "post",
  goalId: null,
  detail: "",
  weekStart: WEEK,
  plannedOn: null,
  kpi: null,
  target: null,
  sns: null,
  status: "todo",
  source: "manual",
  posts: { published: 0, scheduled: 0, linkedPublished: 0, linkedScheduled: 0 },
  ...over,
});
const posts = (published: number) => ({ published, scheduled: 0, linkedPublished: 0, linkedScheduled: 0 });

describe("達成の決め方（effectiveStatus）", () => {
  it("自動で数える数字が目標に届いたまだのやることは達成。届かなければまだ", () => {
    expect(effectiveStatus({ status: "todo" }, { actual: 5, target: 3 })).toBe("achieved");
    expect(effectiveStatus({ status: "todo" }, { actual: 3, target: 3 })).toBe("achieved");
    expect(effectiveStatus({ status: "todo" }, { actual: 2, target: 3 })).toBe("todo");
  });

  it("目標がない・手で数える数字（進み具合が出ない）はまだのまま。済み・やらないは手で決めたまま", () => {
    expect(effectiveStatus({ status: "todo" }, null)).toBe("todo");
    const manual = item({ kpi: "followers", target: 10 });
    expect(itemProgress(manual, [])).toBeNull();
    expect(effectiveStatus(manual, itemProgress(manual, []))).toBe("todo");
    expect(effectiveStatus({ status: "done" }, { actual: 0, target: 3 })).toBe("done");
    expect(effectiveStatus({ status: "skipped" }, { actual: 9, target: 3 })).toBe("skipped");
  });

  it("クリックの数は、その週の数字で決める（あとで数字が減ればまだに戻る）", () => {
    const clicks = item({ kind: "other", kpi: "link_clicks", target: 10 });
    const daily = (n: number) => [{ day: "2026-11-03", posts: 0, link_clicks: n }];
    expect(effectiveStatus(clicks, itemProgress(clicks, daily(12)))).toBe("achieved");
    expect(effectiveStatus(clicks, itemProgress(clicks, daily(9)))).toBe("todo");
  });
});

// 2026-11-12 PMO の本番での通しテスト: 数字のない投稿のやることは、ここから投稿をつくって送っても「まだ」に残った
describe("数字で数えないやることは、ここから作った投稿を送ったら達成", () => {
  const linked = (linkedPublished: number, linkedScheduled = 0) => ({ published: linkedPublished, scheduled: linkedScheduled, linkedPublished, linkedScheduled });

  it("結びついた投稿の配信先が 1 つ以上送信済みなら達成。予約だけ・なしはまだ", () => {
    expect(effectiveStatus(item({ posts: linked(1) }), null)).toBe("achieved");
    expect(effectiveStatus(item({ posts: linked(0, 2) }), null)).toBe("todo");
    expect(effectiveStatus(item({ posts: linked(0) }), null)).toBe("todo");
    expect(effectiveStatus(item({ posts: null }), null)).toBe("todo");
  });

  it("手で数える数字（フォロワーなど）のやることも、ここから作った投稿を送れば達成", () => {
    const manual = item({ kind: "other", kpi: "followers", target: 10, posts: linked(1) });
    expect(effectiveStatus(manual, itemProgress(manual, []))).toBe("achieved");
  });

  it("自動で数える数字があるやることは、その数字で決める（結びついた投稿を送っても、目標に届かなければまだ）", () => {
    const three = item({ kpi: "posts", target: 3, posts: linked(1) });
    expect(effectiveStatus(three, itemProgress(three, []))).toBe("todo");
  });

  it("済み・やらないは手で決めたまま", () => {
    expect(effectiveStatus(item({ status: "skipped", posts: linked(1) }), null)).toBe("skipped");
    expect(effectiveStatus(item({ status: "done" }), null)).toBe("done");
  });
});

describe("今週のやること（概要の帯・残りの一覧・件数）", () => {
  // オーナーの ddy: 「X と Instagram に合わせて 3 本投稿」は 5 / 3 で達成。ほかに 2 件まだ、1 件済み、1 件やらない
  const view: RoadmapView = {
    today: "2026-11-03",
    thisWeek: WEEK,
    daily: [],
    items: [
      item({ id: "a", title: "XとInstagramに合わせて3本投稿", kpi: "posts", target: 3, posts: posts(5) }),
      item({ id: "b", title: "プロフィールを見直す", kind: "other" }),
      item({ id: "c", title: "Threads に 2 本", kpi: "posts", target: 2, sns: "threads", posts: posts(1) }),
      item({ id: "d", title: "済み", status: "done" }),
      item({ id: "e", title: "やらない", status: "skipped" }),
      item({ id: "f", title: "来週", weekStart: "2026-11-09" }),
    ],
  };

  it("先頭は達成していないやること。件数は達成と済みを除いた数で、上限で切らない", () => {
    expect(thisWeekTodos(view).map((t) => t.id)).toEqual(["b", "c"]);
    expect(thisWeekCounts(view)).toEqual({ open: 2, finished: 2 });
    expect(thisWeekTodos(view, 1).map((t) => t.id)).toEqual(["b"]);
  });

  it("全部が達成か済みなら、まだのやることは 0 件（帯は「今週のやることは済みました」）", () => {
    const done: RoadmapView = { ...view, items: view.items.filter((i) => ["a", "d", "e"].includes(i.id)) };
    expect(thisWeekTodos(done)).toEqual([]);
    expect(thisWeekCounts(done)).toEqual({ open: 0, finished: 2 });
  });
});

describe("カレンダーの印と予定日を過ぎたやること", () => {
  const reached = item({ id: "a", kpi: "posts", target: 3, posts: posts(3), plannedOn: "2026-11-02" });

  it("カレンダーでは達成（✓）。予定日を過ぎても、達成していれば声をかけない", () => {
    expect(toCalendarTodo(reached, [], "2026-11-04")).toMatchObject({ status: "achieved", overdue: false });
    expect(overdueItems([reached], "2026-11-04")).toEqual([]);
    const notYet = { ...reached, posts: posts(1) };
    expect(toCalendarTodo(notYet, [], "2026-11-04")).toMatchObject({ status: "todo", overdue: true });
    expect(overdueItems([notYet], "2026-11-04")).toHaveLength(1);
  });
});
