// カレンダーに出すロードマップのやること（F06・F10。docs/architecture.md の 4.23）: 進み具合の文、予定日を過ぎたもの
import { describe, expect, it } from "vitest";
import { toCalendarTodo } from "@/lib/calendar/roadmap-view";
import { overdueItems, type RoadmapItem } from "@/lib/roadmap/load";
import { itemProgress } from "@/lib/roadmap/schema";

const base: RoadmapItem = {
  id: "i1",
  title: "Instagram に 2 本",
  detail: "",
  weekStart: "2026-10-12",
  plannedOn: null,
  kpi: "posts",
  target: 2,
  sns: "instagram",
  status: "todo",
  source: "manual",
  posts: { published: 1, scheduled: 1, linkedPublished: 0, linkedScheduled: 0 },
};

describe("やることの進み具合", () => {
  it("投稿した回数は DB で数えたもの（結びついた投稿を含む）を使う", () => {
    // daily には週の外の結びついた投稿が入らないので、DB の数を優先する
    expect(itemProgress(base, [{ day: "2026-10-12", posts: 5, link_clicks: 0, postsBySns: { instagram: 0 } }])).toEqual({ actual: 1, target: 2 });
    expect(itemProgress({ ...base, posts: null }, [{ day: "2026-10-12", posts: 5, link_clicks: 0, postsBySns: { instagram: 1 } }])).toEqual({ actual: 1, target: 2 });
  });

  it("カレンダーの文: 「Instagram 1 / 2（予約 1）」、すべての SNS、作った投稿", () => {
    expect(toCalendarTodo(base, [], "2026-10-13")).toMatchObject({ progress: "Instagram 1 / 2（予約 1）", linked: null, overdue: false });
    expect(toCalendarTodo({ ...base, sns: null, posts: { published: 3, scheduled: 0, linkedPublished: 1, linkedScheduled: 2 } }, [], "2026-10-13")).toMatchObject({
      progress: "すべての SNS 3 / 2",
      linked: "ここから作った投稿: 送信済み 1・予約 2",
    });
    expect(toCalendarTodo({ ...base, kpi: null, target: null, sns: null }, [], "2026-10-13").progress).toBeNull();
  });
});

describe("予定日を過ぎたやること", () => {
  const today = "2026-10-15";
  it("済んでいない・予定日が今日より前・ここから予約も送信もしていないもの", () => {
    const items: RoadmapItem[] = [
      { ...base, id: "late", plannedOn: "2026-10-13" },
      { ...base, id: "today", plannedOn: "2026-10-15" },
      { ...base, id: "done", plannedOn: "2026-10-13", status: "done" },
      { ...base, id: "skipped", plannedOn: "2026-10-13", status: "skipped" },
      { ...base, id: "made", plannedOn: "2026-10-13", posts: { published: 1, scheduled: 0, linkedPublished: 0, linkedScheduled: 1 } },
      { ...base, id: "noDate", plannedOn: null },
    ];
    expect(overdueItems(items, today).map((i) => i.id)).toEqual(["late"]);
    expect(toCalendarTodo(items[0], [], today).overdue).toBe(true);
    expect(toCalendarTodo(items[4], [], today).overdue).toBe(false);
  });
});
