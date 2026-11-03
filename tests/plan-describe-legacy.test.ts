// 前に保存した AI の案（前の目標の値・今はない KPI）を表示しても止まらない（2026-11-03 本番で AI と考えるが開けなかった不具合）
import { describe, expect, it } from "vitest";
import { describeSection } from "@/lib/plan/describe";

describe("describeSection（前の値）", () => {
  it("goalType の前の値は読み替えて出す", () => {
    const rows = describeSection("goal", { what: "アプリ", goalType: "downloads", note: "" } as never);
    expect(rows.find((r) => r.label.startsWith("いちばんの目標"))?.text).toBeTruthy();
  });
  it("わからない goalType・KPI は出さずに止まらない", () => {
    expect(() => describeSection("goal", { what: "x", goalType: "unknown", note: "" } as never)).not.toThrow();
    expect(() => describeSection("firstMonth" as never, { kpis: ["store_page_views", "nope"], weekly: {} } as never)).not.toThrow();
  });
});
