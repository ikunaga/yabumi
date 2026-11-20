// AI で作った画像を送るときの、SNS ごとの AI の印（docs/design/auto-sample-image.md の 2.3）。HTTP はすべてモックし、本物の SNS には送らない。
// Threads: is_made_with_ai（コンテナ。カルーセルは親だけ）/ Instagram: is_ai_generated（同じ）/ X: made_with_ai（投稿）/ Facebook: 欄がない
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstagramAdapter } from "@/lib/sns/adapters/instagram";
import { continueStaged, type StagedOps } from "@/lib/sns/adapters/staged";
import { createThreadsAdapter } from "@/lib/sns/adapters/threads";
import type { PublishImage } from "@/lib/sns/adapters/types";
import { createXAdapter } from "@/lib/sns/adapters/x";

const account = { externalId: "987", accessToken: "token" };
type Call = { url: string; body: URLSearchParams | null; json: unknown };

function mockFetch(replies: unknown[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const b = init?.body;
      const isJson = typeof b === "string" && b.startsWith("{");
      calls.push({ url: String(input), body: b instanceof URLSearchParams ? b : typeof b === "string" && !isJson ? new URLSearchParams(b) : null, json: isJson ? JSON.parse(b as string) : null });
      return new Response(JSON.stringify(replies.shift() ?? {}), { status: 200 });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const image = (n: number, aiGenerated: boolean): PublishImage => ({
  url: `https://storage.example/u/${n}.jpg?token=t`,
  altText: "",
  load: async () => new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9]),
  aiGenerated,
});

describe("Threads", () => {
  it("AI の画像 1 枚は、コンテナに is_made_with_ai を付ける。AI でない画像には付けない", async () => {
    const calls = mockFetch([{ id: "c1" }, { status: "FINISHED" }, { id: "m1" }, {}]);
    await createThreadsAdapter({ sleep: async () => {} }).publishText(account, "本文", [image(1, true)]);
    expect(calls[0].body?.get("is_made_with_ai")).toBe("true");
    const plain = mockFetch([{ id: "c1" }, { status: "FINISHED" }, { id: "m1" }, {}]);
    await createThreadsAdapter({ sleep: async () => {} }).publishText(account, "本文", [image(1, false)]);
    expect(plain[0].body?.get("is_made_with_ai")).toBeNull();
  });

  it("カルーセルは、子に付けず親に付ける（子に付けると断られる）", async () => {
    const calls = mockFetch([{ id: "i1" }, { id: "i2" }, { id: "car" }, { status: "FINISHED" }, { id: "m2" }, {}]);
    await createThreadsAdapter({ sleep: async () => {} }).publishText(account, "本文", [image(1, false), image(2, true)]);
    expect(calls[0].body?.get("is_made_with_ai")).toBeNull();
    expect(calls[1].body?.get("is_made_with_ai")).toBeNull();
    expect(calls[2].body?.get("media_type")).toBe("CAROUSEL");
    expect(calls[2].body?.get("is_made_with_ai")).toBe("true");
  });

  it("段階で進めるカルーセルは、状態に印を持ち、親を作るときに渡す", async () => {
    mockFetch([{ id: "i1" }, { id: "i2" }]);
    const state = await createThreadsAdapter({ sleep: async () => {} }).startPublish!(account, "本文", [image(1, true), image(2, false)]);
    expect(state).toMatchObject({ kind: "carousel", ai: true });
    const createCarousel = vi.fn(async () => "parent");
    const ops: StagedOps = { label: "Threads", status: async () => ({ status: "FINISHED" }), createCarousel, publish: async () => "m", permalink: async () => null, toError: (e) => e as never };
    await continueStaged(ops, state);
    expect(createCarousel).toHaveBeenCalledWith(["i1", "i2"], "本文", true);
  });
});

describe("Instagram", () => {
  const fast = () => createInstagramAdapter({ sleep: async () => {}, pollIntervalMs: 0, maxPolls: 3 });
  it("AI の画像 1 枚は、コンテナに is_ai_generated を付ける。カルーセルは親だけ", async () => {
    const one = mockFetch([{ id: "c1" }, { status_code: "FINISHED" }, { id: "m1" }, {}]);
    await fast().publishText(account, "本文", [image(1, true)]);
    expect(one[0].body?.get("is_ai_generated")).toBe("true");
    const car = mockFetch([{ id: "i1" }, { status_code: "FINISHED" }, { id: "i2" }, { status_code: "FINISHED" }, { id: "car" }, { status_code: "FINISHED" }, { id: "m2" }, {}]);
    await fast().publishText(account, "本文", [image(1, true), image(2, false)]);
    expect(car[0].body?.get("is_ai_generated")).toBeNull();
    expect(car[4].body?.get("media_type")).toBe("CAROUSEL");
    expect(car[4].body?.get("is_ai_generated")).toBe("true");
  });
});

describe("X", () => {
  const config = () => ({ clientId: "c", clientSecret: "s", redirectUri: "https://localhost:3100/sns/x/callback" });
  it("AI の画像があれば、投稿に made_with_ai を付ける（画像のアップロードには欄がない）。なければ付けない", async () => {
    const calls = mockFetch([{ data: { id: "md1" } }, { data: { id: "p1" } }]);
    await createXAdapter(config).publishText(account, "本文", [image(1, true)]);
    expect(calls[1].json).toEqual({ text: "本文", media: { media_ids: ["md1"] }, made_with_ai: true });
    const plain = mockFetch([{ data: { id: "md1" } }, { data: { id: "p1" } }]);
    await createXAdapter(config).publishText(account, "本文", [image(1, false)]);
    expect(plain[1].json).toEqual({ text: "本文", media: { media_ids: ["md1"] } });
  });
});
