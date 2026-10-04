import { describe, expect, it } from "vitest";
import { projectInputSchema } from "@/lib/projects/schema";

const base = { name: "かけいぼ日和", description: "", target_audience: "", app_store_url: "", play_store_url: "" };

describe("projectInputSchema", () => {
  it("空のストア URL は null にする", () => {
    const r = projectInputSchema.parse(base);
    expect(r.app_store_url).toBeNull();
    expect(r.play_store_url).toBeNull();
  });

  it("正しいストア URL を受け付ける", () => {
    const r = projectInputSchema.parse({
      ...base,
      app_store_url: "https://apps.apple.com/jp/app/id123",
      play_store_url: "https://play.google.com/store/apps/details?id=com.example",
    });
    expect(r.app_store_url).toBe("https://apps.apple.com/jp/app/id123");
  });

  it.each([
    ["app_store_url", "https://example.com/app"],
    ["app_store_url", "http://apps.apple.com/jp/app/id123"],
    ["play_store_url", "https://apps.apple.com/jp/app/id123"],
    ["play_store_url", "javascript:alert(1)"],
  ])("%s に不正な URL %s を入れると弾く", (key, value) => {
    expect(projectInputSchema.safeParse({ ...base, [key]: value }).success).toBe(false);
  });

  it("アプリ名は必須で、前後の空白は除く", () => {
    expect(projectInputSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    expect(projectInputSchema.parse({ ...base, name: "  A  " }).name).toBe("A");
  });
});
