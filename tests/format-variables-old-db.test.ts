// 本番の切り替わりの数分（新しいコードを先に出し、そのあと db push。docs/deploy.md）: 新しいコードが、まだ移していない DB の行で
// 自動投稿の 1 回を作れるか。古い形の series（answer・slots）と、answer 列のある記録・作り方の控えのない回し方を、偽の DB で読ませる（2026-11-21 PM の依頼）
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { pickMaterial } from "@/lib/auto-post/materials";
import { normalizePlan } from "@/lib/plan/schema";

// from(表).select().eq()… の形だけをまねる偽の DB（読むだけ。書くと失敗にする）
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "in", "is", "gte"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      chain.single = async () => ({ data: rows[0] ?? null, error: null });
      chain.then = (ok: (v: unknown) => unknown) => ok({ data: rows, error: null });
      for (const m of ["insert", "update", "delete", "upsert"]) chain[m] = () => ({ then: (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "書かない" } }) });
      return chain;
    },
  };
}

describe("古い DB の行でも、自動投稿の 1 回を作れる", () => {
  it("古い形の series を変数として読み、answer 列のある記録を読んで、本文を作る（作り方の控えのない回し方は要確認にしない）", async () => {
    const formatId = "00000000-0000-0000-0000-0000000000f1";
    const db = fakeDb({
      post_formats: [
        {
          id: formatId,
          name: "連想映画クイズ",
          purpose: "",
          body: "連想映画クイズ🎬\n{キーワード}\nこの 5 つから連想する映画は？",
          example: "",
          pillar: "",
          hashtags: {},
          series: { answer: { name: "映画", instruction: "だれでも知っている映画を 1 つ" }, slots: { キーワード: "答えの映画を連想できる言葉を 5 つ" } },
          image: {},
        },
      ],
      post_format_rounds: [{ id: "r1", answer: "タイタニック", values: { キーワード: "豪華客船・氷山" }, source: "ai", post_id: null, created_at: "2026-11-20T00:00:00Z" }],
    });
    const plan = { id: "p", projectId: "proj", ownerId: "u", kind: "series", materials: { format_id: formatId }, targets: { threads: "auto" }, instructions: [] } as never;
    const m = await pickMaterial(
      db as never,
      { plan, planData: normalizePlan({}, ""), project: { name: "ねむり日和", description: null, target_audience: null, product_type: "app" }, past: [], dueAt: new Date() },
      { fakeSeries: true },
    );
    expect(m).toMatchObject({
      fixedTexts: { threads: "連想映画クイズ🎬\n（偽の AI）キーワード 2\nこの 5 つから連想する映画は？" },
      series: { formatId, values: { 映画: "（偽の AI）映画 2", キーワード: "（偽の AI）キーワード 2" } },
    });
  });
});
