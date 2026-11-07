// ロードマップの形と進み具合の計算（docs/architecture.md の 4.23）
import { describe, expect, it } from "vitest";
import { goalKpiKeys, kgiExample, kgiSchema, notCountedYet, itemProgress, itemSchema, itemsProposalSchema, kpiChoiceValue, kpiLabel, kpiTargetsSchema, parseKpiChoice, weekStartOf, weekValue, type DailyTotal } from "@/lib/roadmap/schema";

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

  it("AI の提案: やること（何週目かで受け取る）", () => {
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

  it("画面の名前と選択肢の値", () => {
    expect(kpiLabel("posts", "instagram")).toBe("投稿した回数（Instagram）");
    expect(kpiLabel("posts", null)).toBe("投稿した回数（すべての SNS）");
    // 決定 D34 で、アプリ以外にも合う名前に（アプリの画面では clickLabel で「ストアへのクリック」）
    expect(kpiLabel("link_clicks", null)).toBe("行き先へのクリック");
    expect(kpiChoiceValue("posts", "x")).toBe("posts:x");
    expect(kpiChoiceValue("link_clicks", null)).toBe("link_clicks");
    expect(parseKpiChoice("posts:x")).toEqual({ kpi: "posts", sns: "x" });
    expect(parseKpiChoice("posts")).toEqual({ kpi: "posts", sns: null });
    expect(parseKpiChoice(null)).toEqual({ kpi: "", sns: null });
  });
});

describe("目標と数字の欄を種類で絞る（決定 D34）", () => {
  it("アプリ以外はストアの 3 つを出さない。いま選んでいるもの（種類をアプリから変えた人）は残して、黙って変えない", () => {
    expect(goalKpiKeys("app")).toContain("downloads");
    expect(goalKpiKeys("shop").some((k) => ["store_page_views", "downloads", "revenue"].includes(k))).toBe(false);
    expect(goalKpiKeys("shop", ["downloads"])).toContain("downloads");
    expect(goalKpiKeys("shop", ["downloads"])).not.toContain("revenue");
  });

  it("アプリ以外でストアの数字を選んでいたら、つなぐ案内ではなく選び直しを案内する", () => {
    expect(notCountedYet("downloads", "app")).toMatch(/App Store か Google Play をつなぐ/);
    expect(notCountedYet("downloads", "shop")).toMatch(/アプリ」のときだけ数えます/);
    expect(notCountedYet("views", "shop")).toMatch(/つなぐと出ます/);
  });

  it("目標の例は種類ごと。アプリ以外にダウンロードの例を出さない", () => {
    expect(kgiExample("app")).toMatch(/ダウンロード/);
    expect(kgiExample(null)).toMatch(/ダウンロード/);
    for (const t of ["web_service", "shop", "online_shop", "service", "creator", "other"]) expect(kgiExample(t)).not.toMatch(/ダウンロード|ストア/);
  });
});

describe("ありえない日付（2026-11-06 のセキュリティ確認の M1）", () => {
  it("KGI の期限・やることの週に、ない日は入れられない", () => {
    const kgi = { statement: "x", kpi: "link_clicks", target: 10, deadline: "2026-11-31", sns: null };
    // 前の形の KGI（保存してある会話を読むときの形）
    expect(kgiSchema.safeParse(kgi).success).toBe(false);
    expect(kgiSchema.safeParse({ ...kgi, deadline: "2026-11-30" }).success).toBe(true);
    expect(itemSchema.safeParse({ title: "x", detail: "", week_start: "2026-02-30", kpi: null, target: null }).success).toBe(false);
  });
});
