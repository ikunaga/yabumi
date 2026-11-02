// 宣伝するものの種類と、してほしいこと（src/lib/projects/product-types.ts。決定 D34）
import { describe, expect, it } from "vitest";
import {
  actionFromLegacyGoal,
  DESIRED_ACTION_DEFS,
  DESIRED_ACTIONS,
  DESTINATION_KIND_DEFS,
  DESTINATION_KINDS,
  isAppProject,
  PRODUCT_TYPE_DEFS,
  PRODUCT_TYPES,
  RECOMMENDED_ACTIONS,
  RECOMMENDED_DESTINATIONS,
} from "@/lib/projects/product-types";

describe("宣伝するものの種類", () => {
  it("どの種類にも名前・説明・例と、おすすめのしてほしいこと・行き先がある（おすすめは決まった値だけ）", () => {
    for (const t of PRODUCT_TYPES) {
      expect(PRODUCT_TYPE_DEFS[t].label && PRODUCT_TYPE_DEFS[t].description && PRODUCT_TYPE_DEFS[t].examples).toBeTruthy();
      expect(RECOMMENDED_ACTIONS[t].length).toBeGreaterThan(0);
      for (const a of RECOMMENDED_ACTIONS[t]) expect(DESIRED_ACTIONS).toContain(a);
      for (const d of RECOMMENDED_DESTINATIONS[t]) expect(DESTINATION_KINDS).toContain(d);
    }
    for (const a of DESIRED_ACTIONS) expect(DESIRED_ACTION_DEFS[a].label).toBeTruthy();
    for (const d of DESTINATION_KINDS) expect(DESTINATION_KIND_DEFS[d].label).toBeTruthy();
  });

  it("前の目標（downloads・paid・awareness・other）を引き継ぐ。新しい値はそのまま、知らない値は null", () => {
    expect(actionFromLegacyGoal("downloads")).toBe("download");
    expect(actionFromLegacyGoal("paid")).toBe("purchase");
    expect(actionFromLegacyGoal("awareness")).toBe("awareness");
    expect(actionFromLegacyGoal("other")).toBe("other");
    expect(actionFromLegacyGoal("booking")).toBe("booking");
    expect(actionFromLegacyGoal("xxx")).toBeNull();
    expect(actionFromLegacyGoal(null)).toBeNull();
  });

  it("アプリの機能は種類が app のときだけ。種類のない前のデータは app として扱う", () => {
    expect(isAppProject({ product_type: "app" })).toBe(true);
    expect(isAppProject({})).toBe(true);
    expect(isAppProject({ product_type: "shop" })).toBe(false);
  });
});

describe("アカウント設計の目標（見た人にしてほしいこと）", () => {
  it("前の版の値（downloads・paid）は、読むときに download・purchase に読み替える。新しい値はそのまま、決まっていない値は受け付けない", async () => {
    const { normalizePlan, sectionSchemas } = await import("@/lib/plan/schema");
    expect(normalizePlan({ goal: { what: "a", goalType: "downloads", note: "" } }, "").goal.goalType).toBe("download");
    expect(normalizePlan({ goal: { what: "a", goalType: "paid", note: "" } }, "").goal.goalType).toBe("purchase");
    expect(sectionSchemas.goal.parse({ what: "", goalType: "booking", note: "" }).goalType).toBe("booking");
    expect(sectionSchemas.goal.parse({ what: "", note: "" }).goalType).toBeNull();
    expect(sectionSchemas.goal.safeParse({ what: "", goalType: "restaurant", note: "" }).success).toBe(false);
  });
});
