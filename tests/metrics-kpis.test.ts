// 数字の画面の KPI と、アカウント設計の「最初の 1 か月」の kpis（docs/architecture.md の 4.22）
import { describe, expect, it } from "vitest";
import { chosenKpis, kpiAllowed, kpiKeysFor, KPI_KEYS, KPIS, recommendedKpis } from "@/lib/metrics/kpis";
import { normalizePlan, parseSectionForm, sectionSchemas } from "@/lib/plan/schema";

describe("おすすめの KPI", () => {
  it("目的ごとに 4.22 の表のとおり。どれも決まった名前で、3 つまで", () => {
    expect(recommendedKpis("awareness")).toEqual(["views", "followers", "posts"]);
    expect(recommendedKpis("download")).toEqual(["link_clicks", "downloads", "posts"]);
    expect(recommendedKpis("purchase")).toEqual(["downloads", "revenue", "link_clicks"]);
    // アプリでなければ、ストアと RevenueCat の数字は出さない（決定 D34）
    expect(recommendedKpis("purchase", "online_shop")).toEqual(["link_clicks", "outcomes", "posts"]);
    expect(recommendedKpis("booking", "service")).toEqual(["link_clicks", "outcomes", "posts"]);
    expect(recommendedKpis("follow", "creator")).toEqual(["views", "followers", "posts"]);
    expect(recommendedKpis(null)).toEqual(["posts", "link_clicks"]);
    for (const g of ["awareness", "download", "purchase", "signup", "booking", "inquiry", "visit", "follow", "other", null] as const) {
      const r = recommendedKpis(g);
      expect(r.length).toBeLessThanOrEqual(3);
      expect(r.every((k) => (KPI_KEYS as readonly string[]).includes(k))).toBe(true);
    }
  });

  it("まだ数えられない KPI には、何をすると出るかの説明がある", () => {
    for (const k of KPI_KEYS) {
      if (KPIS[k].availability !== "ready") expect(KPIS[k].howToGet).toBeTruthy();
    }
  });
});

describe("最初の 1 か月の kpis", () => {
  it("決まった名前だけ、3 つまで。前の版で保存した設計は空として読む", () => {
    expect(sectionSchemas.first_month.safeParse({ goal: "", metrics: "", kpis: ["posts", "link_clicks"] }).success).toBe(true);
    expect(sectionSchemas.first_month.safeParse({ goal: "", metrics: "", kpis: ["posts", "views", "followers", "revenue"] }).success).toBe(false);
    expect(sectionSchemas.first_month.safeParse({ goal: "", metrics: "", kpis: ["likes"] }).success).toBe(false);
    expect(normalizePlan({ first_month: { goal: "12 回投稿", metrics: "" } }, "").first_month.kpis).toEqual([]);
  });

  it("画面のフォーム（チェック）から読む", () => {
    const form = new FormData();
    form.set("goal", "12 回投稿する");
    form.set("metrics", "");
    form.append("kpis", "posts");
    form.append("kpis", "link_clicks");
    const r = parseSectionForm("first_month", form);
    expect(r.success && r.data.kpis).toEqual(["posts", "link_clicks"]);
  });
});

describe("種類で絞る数字（決定 D34）", () => {
  const STORE = ["store_page_views", "downloads", "revenue"];

  it("アプリ（と種類のない前のデータ）はすべて、アプリ以外はストアの 3 つを外す", () => {
    expect(kpiKeysFor("app")).toEqual([...KPI_KEYS]);
    expect(kpiKeysFor(null)).toEqual([...KPI_KEYS]);
    for (const t of ["web_service", "shop", "online_shop", "service", "creator", "other"]) {
      const keys = kpiKeysFor(t);
      expect(keys.some((k) => STORE.includes(k))).toBe(false);
      expect(keys).toContain("outcomes");
      expect(keys).toContain("link_clicks");
    }
    expect(kpiAllowed("downloads", "shop")).toBe(false);
    expect(kpiAllowed("downloads", "app")).toBe(true);
  });

  it("選んだ数字: アプリ以外ではストアの 3 つを外し、残りがなければ目的からのおすすめ", () => {
    expect(chosenKpis(["downloads", "link_clicks"], "download", "app")).toEqual(["downloads", "link_clicks"]);
    // 種類をアプリからお店に変えた人
    expect(chosenKpis(["downloads", "link_clicks"], "download", "shop")).toEqual(["link_clicks"]);
    expect(chosenKpis(["downloads", "revenue"], "visit", "shop")).toEqual(["link_clicks", "outcomes", "posts"]);
    expect(chosenKpis([], "purchase", "online_shop")).toEqual(["link_clicks", "outcomes", "posts"]);
    expect(chosenKpis(undefined, null, "app")).toEqual(["posts", "link_clicks"]);
  });
});
