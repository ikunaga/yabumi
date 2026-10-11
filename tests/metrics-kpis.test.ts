// 数字の画面の KPI と、アカウント設計の「最初の 1 か月」の kpis（docs/architecture.md の 4.22）
import { describe, expect, it } from "vitest";
import { KPI_KEYS, KPIS, recommendedKpis } from "@/lib/metrics/kpis";
import { normalizePlan, parseSectionForm, sectionSchemas } from "@/lib/plan/schema";

describe("おすすめの KPI", () => {
  it("目的ごとに 4.22 の表のとおり。どれも決まった名前で、3 つまで", () => {
    expect(recommendedKpis("awareness")).toEqual(["views", "followers", "posts"]);
    expect(recommendedKpis("downloads")).toEqual(["link_clicks", "downloads", "posts"]);
    expect(recommendedKpis("paid")).toEqual(["downloads", "revenue", "link_clicks"]);
    expect(recommendedKpis(null)).toEqual(["posts", "link_clicks"]);
    for (const g of ["awareness", "downloads", "paid", "other", null] as const) {
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
