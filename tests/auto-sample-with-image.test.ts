// 「テストで 1 本つくる」で、画像の設定があれば文と一緒に画像もつくる（2026-11-21 オーナーの決定）。
// サーバーの操作 makeAutoSample の組み立てだけを見る（engine は偽物。本物の AI は呼ばない。engine の中身は結合テスト）
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sampleResult = { ok: true, sampleId: "33333333-3333-4333-8333-333333333333", texts: { threads: "本文" }, tags: {}, label: "メモ: 見本", issues: [] as { kind: string; detail: string }[] };
const makeSample = vi.fn(async () => sampleResult);
let imageOk = true;
const makeSampleImage = vi.fn(async () => (imageOk ? { ok: true, image: { path: "u/gen/a.jpg", width: 1080, height: 1350, alt: "場面" } } : { ok: false, detail: "画像の AI が断りました" }));
vi.mock("@/lib/auto-post/engine", () => ({ engineDeps: () => ({ image: {} }), makeSample, makeSampleImage, adoptSample: vi.fn(), NO_PLAN_ID: "00000000-0000-4000-8000-000000000000" }));
vi.mock("@/lib/auto-post/holds", () => ({ HOLD_REFUSED: "止めています", myAutoPostHold: async () => null }));
vi.mock("@/lib/supabase/server", () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: "p" }, error: null }) };
  return { createClient: async () => ({ from: () => q, auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }) };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://x/${path}` }, error: null }) }) } }),
}));

const { makeAutoSample } = await import("@/lib/auto-post/actions");
const PROJECT = "11111111-1111-4111-8111-111111111111";
const input = (image: unknown) =>
  ({
    name: "テスト",
    kind: "notes",
    materials: { note_order: "old_first" },
    targets: { threads: "auto" },
    xLink: "never",
    schedule: { weekdays: [2], time: "19:00", every_weeks: 1, start: "2026-11-22" },
    instructions: [],
    image,
    leadHours: 24,
  }) as never;
const AI = { source: "ai", style: "illustration", size: "auto", headline: "none" };

beforeEach(() => {
  makeSampleImage.mockClear();
  imageOk = true;
  sampleResult.issues = [];
});

describe("テストで 1 本つくる（makeAutoSample）", () => {
  it("画像の設定があれば、文と一緒に画像もつくって返す", async () => {
    const r = await makeAutoSample(PROJECT, input(AI));
    expect(r.ok && r.data.image?.url).toBe("https://x/u/gen/a.jpg");
    expect(r.ok && r.data.imageFailed).toBe(false);
    expect(makeSampleImage).toHaveBeenCalledTimes(1);
  });

  it("注意が出ても、画像までつくる（注意はそのまま返す）", async () => {
    sampleResult.issues = [{ kind: "made_up", detail: "本当ですか" }];
    const r = await makeAutoSample(PROJECT, input(AI));
    expect(r.ok && r.data.image).toBeTruthy();
    expect(r.ok && r.data.issues).toEqual([{ kind: "made_up", detail: "本当ですか" }]);
  });

  it("画像をつくれなかったら、文だけ返して imageFailed を付ける", async () => {
    imageOk = false;
    const r = await makeAutoSample(PROJECT, input(AI));
    expect(r.ok && r.data.texts).toEqual({ threads: "本文" });
    expect(r.ok && r.data.image).toBeNull();
    expect(r.ok && r.data.imageFailed).toBe(true);
  });

  it("画像の設定がなければ、画像はつくらない", async () => {
    const r = await makeAutoSample(PROJECT, input(null));
    expect(makeSampleImage).not.toHaveBeenCalled();
    expect(r.ok && r.data.image).toBeUndefined();
    expect(r.ok && r.data.imageFailed).toBeUndefined();
  });
});
