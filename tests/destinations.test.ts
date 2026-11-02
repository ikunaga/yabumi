// 行き先の URL のフォームと、短縮リンクの行き先の候補（src/lib/projects/destinations.ts。決定 D34）
import { describe, expect, it } from "vitest";
import { destinationCandidates, MAX_DESTINATIONS, parseDestinationsForm } from "@/lib/projects/destinations";
import { parseProjectForm } from "@/lib/projects/schema";

function form(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("行き先の URL のフォーム", () => {
  it("URL のある行だけを読み、名前と種類を持つ。https でない URL・決まっていない種類は行の番号つきで断る", () => {
    const r = parseDestinationsForm(form({ "dest-0-kind": "booking", "dest-0-label": " 予約 ", "dest-0-url": "https://example.com/r", "dest-1-kind": "site", "dest-1-url": "", "dest-2-kind": "shop", "dest-2-url": "https://shop.example" }));
    expect(r).toEqual({
      ok: true,
      items: [
        { id: null, kind: "booking", label: "予約", url: "https://example.com/r" },
        { id: null, kind: "shop", label: "", url: "https://shop.example" },
      ],
    });
    expect(parseDestinationsForm(form({ "dest-0-kind": "site", "dest-0-url": "http://example.com" }))).toEqual({ ok: false, error: "行き先の URL の 1 行目: https:// から始まる URL を入れてください" });
    expect(parseDestinationsForm(form({ "dest-0-kind": "blog", "dest-0-url": "https://example.com" })).ok).toBe(false);
  });

  it(`${MAX_DESTINATIONS} を超えたら断る`, () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i <= MAX_DESTINATIONS; i++) Object.assign(entries, { [`dest-${i}-kind`]: "site", [`dest-${i}-url`]: `https://example.com/${i}` });
    expect(parseDestinationsForm(form(entries)).ok).toBe(false);
  });

  it("プロジェクトのフォーム: 種類は決まった 7 つ。送られてこなければアプリ（前のフォームと同じ）", () => {
    const base = { name: "こむぎ日和", description: "", target_audience: "", app_store_url: "", play_store_url: "" };
    expect(parseProjectForm(form({ ...base, product_type: "shop" })).data?.product_type).toBe("shop");
    expect(parseProjectForm(form(base)).data?.product_type).toBe("app");
    expect(parseProjectForm(form({ ...base, product_type: "restaurant" })).success).toBe(false);
  });
});

describe("短縮リンクの行き先の候補", () => {
  const dests = [
    { id: "1", kind: "booking" as const, label: "予約", url: "https://example.com/r" },
    { id: "2", kind: "site" as const, label: "", url: "https://example.com" },
  ];
  it("アプリならストアの URL を先に。行き先の URL は名前（なければ種類の名前）で。同じ URL は 1 つ", () => {
    const app = { product_type: "app", app_store_url: "https://apps.apple.com/jp/app/id1", play_store_url: null };
    expect(destinationCandidates(app, [...dests, { id: "3", kind: "store", label: "", url: "https://apps.apple.com/jp/app/id1" }]).map((c) => c.label)).toEqual([
      "App Store（https://apps.apple.com/jp/app/id1）",
      "予約（https://example.com/r）",
      "サイト（https://example.com）",
    ]);
  });
  it("アプリでなければ、ストアの URL が残っていても候補にしない（ストアの URL がなくても行き先から作れる）", () => {
    const shop = { product_type: "shop", app_store_url: "https://apps.apple.com/jp/app/id1", play_store_url: null };
    expect(destinationCandidates(shop, dests).map((c) => c.url)).toEqual(["https://example.com/r", "https://example.com"]);
    expect(destinationCandidates({ product_type: "shop", app_store_url: null, play_store_url: null }, [])).toEqual([]);
  });
});
