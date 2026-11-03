// 学びの記録の server action（src/lib/learning/actions.ts）: ログインを確かめてから進むこと（セキュリティ確認 2026-11-03 の L3・L4）と、
// 用語集の詳細ページを描くだけでは「読んだ」を記録しないこと（L3）
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn(async () => ({ error: null }));
let sub: string | null = null;
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, auth: { getClaims: async () => ({ data: sub ? { claims: { sub } } : null }) } }),
}));

const { dismissTodayTerm, recordTermRead } = await import("@/lib/learning/actions");
const PROJECT = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rpc.mockClear();
  revalidatePath.mockClear();
  sub = null;
});

describe("dismissTodayTerm（L4）", () => {
  it("ログインしていなければ、DB も画面のキャッシュも触らない", async () => {
    await dismissTodayTerm(PROJECT);
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("ログインしていれば閉じて、その画面を描き直す", async () => {
    sub = "u1";
    await dismissTodayTerm(PROJECT);
    expect(rpc).toHaveBeenCalledWith("dismiss_learning_today_term");
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT}`);
  });
});

describe("recordTermRead（L3）", () => {
  it("ログインしていない・用語集にない key は記録しない", async () => {
    await recordTermRead("persona");
    sub = "u1";
    await recordTermRead("notakey");
    await recordTermRead(123);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ログインしていれば記録し、一覧の印を新しくする", async () => {
    sub = "u1";
    await recordTermRead("persona");
    expect(rpc).toHaveBeenCalledWith("record_learning_term_read", { p_term_key: "persona" });
    expect(revalidatePath).toHaveBeenCalledWith("/glossary");
  });

  it("詳細ページを描く（GET・先読み）だけでは送らない。画面を描いたあとにクライアントから送る", async () => {
    sub = "u1";
    const { RecordTermRead } = await import("@/components/glossary/record-read");
    expect(renderToStaticMarkup(createElement(RecordTermRead, { termKey: "persona" }))).toBe("");
    expect(rpc).not.toHaveBeenCalled();
    // ページはサーバーで記録する関数を呼ばない
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/(app)/glossary/[key]/page.tsx", "utf8");
    expect(page).not.toMatch(/record_learning_term_read|recordTermRead\(/);
  });
});
