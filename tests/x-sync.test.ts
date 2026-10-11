// X の投稿がまだあるかの読み取り（応答の読み方と、URL から ID を取る）。本物の X は呼ばない
import { afterEach, describe, expect, it, vi } from "vitest";
import { readXPostState, xPostIdFromUrl, XReadError } from "@/lib/sns/x/sync";

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));
}

afterEach(() => vi.unstubAllGlobals());

describe("X の投稿の状態", () => {
  it("投稿があれば exists", async () => {
    mockFetch(200, { data: { id: "1", text: "x" } });
    expect(await readXPostState("t", "1")).toBe("exists");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.x.com/2/tweets/1");
  });

  it("見つからない（200 の errors でも、404 でも）なら removed", async () => {
    mockFetch(200, { errors: [{ type: "https://api.twitter.com/2/problems/resource-not-found", detail: "Could not find tweet" }] });
    expect(await readXPostState("t", "1")).toBe("removed");
    mockFetch(404, { type: "https://api.x.com/2/problems/resource-not-found" });
    expect(await readXPostState("t", "1")).toBe("removed");
  });

  it("それ以外の失敗（接続切れ・上限・障害）は、消えたとはみなさない", async () => {
    for (const [status, body] of [
      [401, { title: "Unauthorized" }],
      [402, { type: "https://api.x.com/2/problems/CreditsDepleted" }],
      [503, {}],
      [200, { errors: [{ type: "https://api.twitter.com/2/problems/not-authorized-for-resource" }] }],
    ] as const) {
      mockFetch(status, body);
      await expect(readXPostState("t", "1")).rejects.toBeInstanceOf(XReadError);
    }
  });

  it("手で記録した URL から投稿の ID を取る", () => {
    expect(xPostIdFromUrl("https://x.com/alice/status/123")).toBe("123");
    expect(xPostIdFromUrl("https://twitter.com/alice/status/123?s=20")).toBe("123");
    expect(xPostIdFromUrl("https://x.com/i/web/status/456")).toBe("456");
    expect(xPostIdFromUrl("https://x.com/alice")).toBeNull();
    expect(xPostIdFromUrl("https://evil.example/x.com/alice/status/1")).toBeNull();
    expect(xPostIdFromUrl(null)).toBeNull();
  });
});
