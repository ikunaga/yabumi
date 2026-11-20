// 保存のサーバーの操作（saveAutoPlan）が、シリーズの画像をいまのフォーマットの画像の設定に合わせること（2026-11-20 オーナーの指摘）。
// 画面が古いまま「AI がつくる」などを送ってきても、フォーマットに画像の設定があれば source=format で保存する
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn<(fn: string, args: unknown) => Promise<{ data: string; error: null }>>(async () => ({ data: "99999999-9999-4999-8999-999999999999", error: null }));
let formatImage: unknown = null;
const from = vi.fn(() => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { image: formatImage }, error: null }) };
  return q;
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from, auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/ai/gemini-image", () => ({ photoConfigured: () => true }));

const { saveAutoPlan } = await import("@/lib/auto-post/actions");
const PROJECT = "11111111-1111-4111-8111-111111111111";
const FORMAT = "22222222-2222-4222-8222-222222222222";
const input = (kind: "series" | "notes", image: unknown) =>
  ({
    name: "テスト",
    kind,
    materials: kind === "series" ? { format_id: FORMAT } : {},
    targets: { threads: "auto" },
    xLink: "never",
    schedule: { weekdays: [2], time: "19:00", every_weeks: 1, start: "2026-11-21" },
    instructions: [],
    image,
    leadHours: 24,
    consent: true,
  }) as never;
const sentImage = () => (rpc.mock.calls.at(-1)![1] as { p_image: unknown }).p_image;
const ai = { source: "ai", style: "photo", size: "portrait", headline: "ai" };

beforeEach(() => {
  rpc.mockClear();
  from.mockClear();
});

describe("saveAutoPlan の画像", () => {
  it("フォーマットに画像と見出しの設定があれば、送られた値にかかわらず source=format・見出しは format", async () => {
    formatImage = { prompt: "{作品}の名場面", scene: "fill", style: "photo", size: "portrait", headline: "{答え}" };
    expect((await saveAutoPlan(PROJECT, input("series", ai))).ok).toBe(true);
    expect(sentImage()).toEqual({ source: "format", style: "illustration", size: "auto", headline: "format" });
    await saveAutoPlan(PROJECT, input("series", null));
    expect(sentImage()).toMatchObject({ source: "format", headline: "format" });
  });

  it("見出しのないフォーマットは headline=none", async () => {
    formatImage = { prompt: "{作品}の名場面", scene: "fill", style: "photo", size: "auto", headline: null };
    await saveAutoPlan(PROJECT, input("series", null));
    expect(sentImage()).toMatchObject({ source: "format", headline: "none" });
  });

  it("フォーマットに画像の設定がなければ、フォーマットの画像は外す（AI がつくるはそのまま）", async () => {
    formatImage = null;
    await saveAutoPlan(PROJECT, input("series", { source: "format", style: "illustration", size: "auto", headline: "format" }));
    expect(sentImage()).toEqual({});
    await saveAutoPlan(PROJECT, input("series", ai));
    expect(sentImage()).toEqual(ai);
  });

  it("シリーズ以外はフォーマットを読まず、そのまま", async () => {
    await saveAutoPlan(PROJECT, input("notes", ai));
    expect(from).not.toHaveBeenCalled();
    expect(sentImage()).toEqual(ai);
  });
});
