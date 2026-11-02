// ログインの cookie で動く route handler を、ほかのサイトから呼ばせない（CSRF）
import { describe, expect, it, vi } from "vitest";
import { isSameOriginJson } from "@/lib/http/same-origin";
vi.mock("server-only", () => ({}));

const req = (headers: Record<string, string>, body = "{}") => new Request("https://yabumi.app/api/ai/tidy-draft", { method: "POST", headers: { host: "yabumi.app", ...headers }, body });
const json = { "content-type": "application/json" };

describe("同じサイトからの JSON だけを受ける", () => {
  it("同じサイトの画面・service worker からの fetch は受ける", () => {
    expect(isSameOriginJson(req({ ...json, origin: "https://yabumi.app", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginJson(req({ "content-type": "application/json; charset=utf-8", origin: "https://yabumi.app" }))).toBe(true);
    // Origin がなければ Referer で見る
    expect(isSameOriginJson(req({ ...json, referer: "https://yabumi.app/projects/x/compose" }))).toBe(true);
  });

  it("ほかのサイトからは受けない", () => {
    expect(isSameOriginJson(req({ ...json, origin: "https://evil.example" }))).toBe(false);
    expect(isSameOriginJson(req({ ...json, referer: "https://evil.example/page" }))).toBe(false);
    expect(isSameOriginJson(req({ ...json, origin: "https://yabumi.app.evil.example" }))).toBe(false);
    expect(isSameOriginJson(req({ ...json, origin: "https://yabumi.app", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginJson(req({ ...json, origin: "https://go.yabumi.app", "sec-fetch-site": "same-site" }))).toBe(false);
    // 呼び元がわからないものも受けない
    expect(isSameOriginJson(req({ ...json }))).toBe(false);
    expect(isSameOriginJson(req({ ...json, origin: "null" }))).toBe(false);
  });

  it("フォームで送れる形（JSON でない）は受けない", () => {
    expect(isSameOriginJson(req({ "content-type": "text/plain", origin: "https://yabumi.app" }))).toBe(false);
    expect(isSameOriginJson(req({ "content-type": "application/x-www-form-urlencoded", origin: "https://yabumi.app" }))).toBe(false);
    expect(isSameOriginJson(req({ "content-type": "multipart/form-data; boundary=x", origin: "https://yabumi.app" }))).toBe(false);
  });

  it("route では、ログインを見る前に 403 で断る（DB や AI には届かない）", async () => {
    // route を読み込むと環境変数を確かめるので、届かない仮の値を置く
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "dummy");
    vi.stubEnv("SUPABASE_SECRET_KEY", "dummy");
    const { POST: tidyDraft } = await import("@/app/api/ai/tidy-draft/route");
    const { POST: renewPush } = await import("@/app/api/push/renew/route");
    const cross = { "content-type": "text/plain", origin: "https://evil.example" };
    expect((await tidyDraft(req(cross, JSON.stringify({ projectId: crypto.randomUUID(), text: "a", sns: ["x"] })))).status).toBe(403);
    expect((await renewPush(req(cross, JSON.stringify({ oldEndpoint: null, subscription: {} })))).status).toBe(403);
  });
});
