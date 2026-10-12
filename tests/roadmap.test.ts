// ロードマップの形と進み具合の計算（docs/architecture.md の 4.23）
import { describe, expect, it } from "vitest";
import { goalProposalSchema, itemProgress, itemSchema, itemsProposalSchema, kgiProgress, kpiChoiceValue, kpiLabel, kpiTargetsSchema, parseKpiChoice, weekStartOf, weekValue, type DailyTotal } from "@/lib/roadmap/schema";

// 2026-10-12 は月曜
const days = (from: string, n: number, f: (i: number) => Partial<DailyTotal>): DailyTotal[] =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { day: d.toISOString().slice(0, 10), posts: 0, link_clicks: 0, ...f(i) };
  });

describe("週の始まり", () => {
  it("日本時間の月曜を返す", () => {
    expect(weekStartOf("2026-10-12")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-18")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19");
  });
});

describe("やることと週の数字", () => {
  const daily = days("2026-10-05", 21, (i) => ({ posts: i % 3 === 0 ? 1 : 0, link_clicks: 2 }));

  it("結びつけた数字の、その週の合計を出す。自動で数えられない数字は出さない", () => {
    expect(itemProgress({ weekStart: "2026-10-12", kpi: "posts", target: 3 }, daily)).toEqual({ actual: 2, target: 3 });
    expect(itemProgress({ weekStart: "2026-10-12", kpi: "link_clicks", target: 10 }, daily)).toEqual({ actual: 14, target: 10 });
    expect(itemProgress({ weekStart: "2026-10-12", kpi: "downloads", target: 5 }, daily)).toBeNull();
    expect(itemProgress({ weekStart: "2026-10-12", kpi: null, target: null }, daily)).toBeNull();
  });

  it("週の数字", () => {
    expect(weekValue("link_clicks", "2026-10-05", daily)).toBe(14);
    expect(weekValue("followers", "2026-10-05", daily)).toBeNull();
  });
});

describe("KGI の進み具合", () => {
  const kgi = { statement: "1 か月で 12 本", kpi: "posts" as const, target: 12, deadline: "2026-11-11", sns: null };

  it("始めた日から今日までの合計と、このままの調子で届きそうかを出す", () => {
    // 14 日で 7 本（1 日 0.5 本）。残り 14 日で 7 本 → 見込み 14 本で届く
    const daily = days("2026-10-01", 28, (i) => ({ posts: i < 14 && i % 2 === 0 ? 1 : 0 }));
    const p = kgiProgress({ ...kgi, deadline: "2026-10-28" }, "2026-10-01", "2026-10-14", daily)!;
    expect(p.actual).toBe(7);
    expect(p.daysLeft).toBe(14);
    expect(p.projected).toBe(14);
    expect(p.onTrack).toBe(true);
  });

  it("始めて 1 週もたっていなければ、調子は判断しない", () => {
    const daily = days("2026-10-10", 3, () => ({ posts: 1 }));
    const p = kgiProgress(kgi, "2026-10-10", "2026-10-12", daily)!;
    expect(p.actual).toBe(3);
    expect(p.onTrack).toBeNull();
  });

  it("自動で数えられない数字の KGI は、進み具合を出さない", () => {
    expect(kgiProgress({ ...kgi, kpi: "downloads" }, "2026-10-01", "2026-10-14", [])).toBeNull();
  });
});

describe("形の確かめ", () => {
  it("やることの週は月曜だけ。数字と目標の値は両方か、両方空", () => {
    expect(itemSchema.safeParse({ title: "1 本書く", week_start: "2026-10-12" }).success).toBe(true);
    expect(itemSchema.safeParse({ title: "1 本書く", week_start: "2026-10-13" }).success).toBe(false);
    expect(itemSchema.safeParse({ title: "1 本書く", week_start: "2026-10-12", kpi: "posts", target: null }).success).toBe(false);
    expect(itemSchema.safeParse({ title: "", week_start: "2026-10-12" }).success).toBe(false);
  });

  it("KPI の週の目標は 6 つまでで、同じ数字と SNS の組は 2 つ置けない。投稿した回数は SNS ごとに置ける", () => {
    expect(kpiTargetsSchema.safeParse([{ kpi: "posts", per_week: 3 }]).success).toBe(true);
    expect(kpiTargetsSchema.safeParse([{ kpi: "posts", per_week: 3 }, { kpi: "posts", per_week: 2 }]).success).toBe(false);
    expect(kpiTargetsSchema.safeParse([{ kpi: "posts", per_week: 2, sns: "x" }, { kpi: "posts", per_week: 1, sns: "instagram" }, { kpi: "posts", per_week: 3 }]).success).toBe(true);
    expect(kpiTargetsSchema.safeParse([{ kpi: "posts", per_week: 2, sns: "x" }, { kpi: "posts", per_week: 1, sns: "x" }]).success).toBe(false);
    expect(kpiTargetsSchema.safeParse(Array.from({ length: 7 }, (_, i) => ({ kpi: "posts", per_week: 1, sns: ["x", "threads", "instagram", "facebook", "tiktok", "youtube", "note"][i] }))).success).toBe(false);
  });

  it("SNS を選べるのは投稿した回数だけ", () => {
    expect(itemSchema.safeParse({ title: "1 本", week_start: "2026-10-12", kpi: "posts", target: 1, sns: "instagram" }).success).toBe(true);
    expect(itemSchema.safeParse({ title: "x", week_start: "2026-10-12", kpi: "link_clicks", target: 1, sns: "instagram" }).success).toBe(false);
    expect(kpiTargetsSchema.safeParse([{ kpi: "views", per_week: 1, sns: "x" }]).success).toBe(false);
    expect(itemsProposalSchema.safeParse({ items: [{ title: "Instagram に 1 本", week: 0, kpi: "posts", target: 1, sns: "instagram" }] }).data?.items[0].sns).toBe("instagram");
    // 前の形（sns なし）は、すべての SNS
    expect(itemsProposalSchema.safeParse({ items: [{ title: "1 本", week: 0 }] }).data?.items[0].sns).toBeNull();
  });

  it("AI の提案: 目標とやること（何週目かで受け取る）", () => {
    expect(
      goalProposalSchema.safeParse({ kgi: { statement: "x", kpi: "posts", target: 12, deadline: "2026-11-30" }, kpi_targets: [{ kpi: "posts", per_week: 3 }] }).success,
    ).toBe(true);
    expect(itemsProposalSchema.safeParse({ items: [{ title: "1 本書く", week: 0 }] }).success).toBe(true);
    expect(itemsProposalSchema.safeParse({ items: [{ title: "1 本書く", week: 53 }] }).success).toBe(false);
    expect(itemsProposalSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe("SNS ごとに数える（2026-10-12 の不具合: Instagram に送っていないのに 2 / 1）", () => {
  // X と Threads に 1 本ずつ
  const daily = days("2026-10-12", 7, (i) => (i === 1 ? { posts: 2, postsBySns: { x: 1, threads: 1 } } : {}));

  it("やることに SNS があれば、その SNS の送信済みだけを数える。null はすべての SNS", () => {
    expect(itemProgress({ weekStart: "2026-10-12", kpi: "posts", target: 1, sns: "instagram" }, daily)).toEqual({ actual: 0, target: 1 });
    expect(itemProgress({ weekStart: "2026-10-12", kpi: "posts", target: 1, sns: "x" }, daily)).toEqual({ actual: 1, target: 1 });
    expect(itemProgress({ weekStart: "2026-10-12", kpi: "posts", target: 1, sns: null }, daily)).toEqual({ actual: 2, target: 1 });
    expect(weekValue("posts", "2026-10-12", daily, "threads")).toBe(1);
  });

  it("KGI も SNS ごとに", () => {
    const p = kgiProgress({ statement: "Instagram に 4 本", kpi: "posts", target: 4, deadline: "2026-11-08", sns: "instagram" }, "2026-10-12", "2026-10-18", daily)!;
    expect(p.actual).toBe(0);
  });

  it("画面の名前と選択肢の値", () => {
    expect(kpiLabel("posts", "instagram")).toBe("投稿した回数（Instagram）");
    expect(kpiLabel("posts", null)).toBe("投稿した回数（すべての SNS）");
    expect(kpiLabel("link_clicks", null)).toBe("ストアへのクリック");
    expect(kpiChoiceValue("posts", "x")).toBe("posts:x");
    expect(kpiChoiceValue("link_clicks", null)).toBe("link_clicks");
    expect(parseKpiChoice("posts:x")).toEqual({ kpi: "posts", sns: "x" });
    expect(parseKpiChoice("posts")).toEqual({ kpi: "posts", sns: null });
    expect(parseKpiChoice(null)).toEqual({ kpi: "", sns: null });
  });
});
