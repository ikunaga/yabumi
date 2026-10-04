// Threads の送信部品。HTTP はすべてモックし、本物の Threads には送らない
import { afterEach, describe, expect, it, vi } from "vitest";
import { createThreadsAdapter } from "@/lib/sns/adapters/threads";
import { SnsPublishError } from "@/lib/sns/adapters/types";

const account = { externalId: "987", accessToken: "token" };
const noSleep = { sleep: async () => {} };

type Reply = { body: unknown; status?: number } | Error;

// 呼ばれた順に返事を返す fetch
function scriptedFetch(replies: Reply[]) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void input;
    void init;
    const r = replies.shift();
    if (!r) throw new Error("想定より多く呼ばれました");
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

async function publishError(replies: Reply[]): Promise<SnsPublishError> {
  scriptedFetch(replies);
  const e = await createThreadsAdapter(noSleep).publishText(account, "こんにちは").catch((e) => e);
  expect(e).toBeInstanceOf(SnsPublishError);
  return e as SnsPublishError;
}

describe("Threads への送信", () => {
  it("コンテナを作って公開し、投稿 ID と URL を返す", async () => {
    const fetch = scriptedFetch([
      { body: { id: "c1" } },
      { body: { status: "FINISHED" } },
      { body: { id: "m1" } },
      { body: { permalink: "https://www.threads.com/@masa/post/abc" } },
    ]);
    const r = await createThreadsAdapter(noSleep).publishText(account, "こんにちは");
    expect(r).toEqual({ externalPostId: "m1", url: "https://www.threads.com/@masa/post/abc" });

    const [createUrl, createInit] = fetch.mock.calls[0];
    expect(String(createUrl)).toBe("https://graph.threads.com/v1.0/me/threads");
    const body = createInit?.body as URLSearchParams;
    expect(body.get("media_type")).toBe("TEXT");
    expect(body.get("text")).toBe("こんにちは");
    const [publishUrl, publishInit] = fetch.mock.calls[2];
    expect(String(publishUrl)).toBe("https://graph.threads.com/v1.0/me/threads_publish");
    expect((publishInit?.body as URLSearchParams).get("creation_id")).toBe("c1");
  });

  it("準備中なら待ってから公開する", async () => {
    const sleep = vi.fn(async () => {});
    scriptedFetch([
      { body: { id: "c1" } },
      { body: { status: "IN_PROGRESS" } },
      { body: { status: "FINISHED" } },
      { body: { id: "m1" } },
      { body: {} },
    ]);
    const r = await createThreadsAdapter({ sleep }).publishText(account, "x");
    expect(r).toEqual({ externalPostId: "m1", url: null });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("準備が終わらなければ、公開せずにやり直しにする", async () => {
    const fetch = scriptedFetch([{ body: { id: "c1" } }, { body: { status: "IN_PROGRESS" } }, { body: { status: "IN_PROGRESS" } }]);
    const e = await createThreadsAdapter({ ...noSleep, maxPolls: 2 }).publishText(account, "x").catch((e) => e);
    expect(e.kind).toBe("retryable");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("URL が取れなくても送信は成功", async () => {
    scriptedFetch([{ body: { id: "c1" } }, { body: { status: "FINISHED" } }, { body: { id: "m1" } }, new Error("network")]);
    expect(await createThreadsAdapter(noSleep).publishText(account, "x")).toEqual({ externalPostId: "m1", url: null });
  });

  it("コンテナがエラーなら、やり直さない失敗", async () => {
    const e = await publishError([{ body: { id: "c1" } }, { body: { status: "ERROR", error_message: "bad text" } }]);
    expect(e.kind).toBe("permanent");
    expect(e.userMessage).toContain("bad text");
  });

  it("トークンが無効（190）なら auth", async () => {
    const e = await publishError([{ body: { error: { message: "Invalid OAuth access token", code: 190 } }, status: 400 }]);
    expect(e.kind).toBe("auth");
  });

  it("回数制限や一時的なエラーはやり直し", async () => {
    expect((await publishError([{ body: { error: { message: "limit", code: 4 } }, status: 400 }])).kind).toBe("retryable");
    expect((await publishError([{ body: { error: { message: "busy", is_transient: true } }, status: 400 }])).kind).toBe("retryable");
    expect((await publishError([{ body: {}, status: 503 }])).kind).toBe("retryable");
  });

  it("コンテナを作る前の通信エラーはやり直し", async () => {
    expect((await publishError([new TypeError("fetch failed")])).kind).toBe("retryable");
  });

  it("公開の途中の通信エラーは、送れたかわからないのでやり直さない", async () => {
    const e = await publishError([{ body: { id: "c1" } }, { body: { status: "FINISHED" } }, new TypeError("fetch failed")]);
    expect(e.kind).toBe("unknown");
  });

  it("投稿を取り消す", async () => {
    const fetch = scriptedFetch([{ body: { success: true, deleted_id: "m1" } }]);
    await createThreadsAdapter(noSleep).deletePost(account, "m1");
    const [url, init] = fetch.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe("/v1.0/m1");
    expect(init?.method).toBe("DELETE");
  });

  it("トークンの延長で 190 が返ったら auth", async () => {
    scriptedFetch([{ body: { error: { message: "expired", code: 190 } }, status: 400 }]);
    const e = await createThreadsAdapter(noSleep).refreshToken!("t", new Date()).catch((e) => e);
    expect(e.kind).toBe("auth");
  });
});
