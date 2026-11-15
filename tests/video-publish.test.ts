// Threads・Instagram（リール）・Facebook（リール）に動画を送る（docs/design/video.md の 5.）。fetch は偽物に差し替え、本物の SNS には送らない
import { afterEach, describe, expect, it, vi } from "vitest";
import { createThreadsAdapter } from "@/lib/sns/adapters/threads";
import { createInstagramAdapter } from "@/lib/sns/adapters/instagram";
import { createFacebookAdapter } from "@/lib/sns/adapters/facebook";
import { createXAdapter } from "@/lib/sns/adapters/x";
import { SnsPublishError, type PrepareState, type PublishVideo } from "@/lib/sns/adapters/types";

type Call = { url: URL; method: string; body: URLSearchParams | null; headers: Headers };

function mockFetch(responses: { status?: number; body: unknown }[] | ((c: Call) => { status?: number; body: unknown })) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: new URL(String(input)), method: init?.method ?? "GET", body: init?.body ? new URLSearchParams(String(init.body)) : null, headers: new Headers(init?.headers) };
      calls.push(call);
      const r = typeof responses === "function" ? responses(call) : (responses.shift() ?? { status: 500, body: {} });
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const video: PublishVideo = {
  url: "https://storage.example/v.mp4?token=x",
  mediaId: "m1",
  sizeBytes: 1000,
  durationMs: 30_000,
  width: 1080,
  height: 1920,
  readRange: async () => new Uint8Array(),
};

describe("Threads の動画", () => {
  const account = { externalId: "u1", accessToken: "th-token" };
  it("VIDEO のコンテナを video_url で作り、待たずに状態を返す。準備できたら公開する", async () => {
    const calls = mockFetch([{ body: { id: "c1" } }, { body: { status: "IN_PROGRESS" } }, { body: { status: "FINISHED" } }, { body: { id: "post-1" } }, { body: { permalink: "https://www.threads.com/p/1" } }]);
    const adapter = createThreadsAdapter();
    const state = await adapter.startPublishVideo!(account, "本文", video);
    expect(state).toEqual({ kind: "single", id: "c1", video: true });
    expect(calls[0].body?.get("media_type")).toBe("VIDEO");
    expect(calls[0].body?.get("video_url")).toBe(video.url);
    expect(calls[0].body?.get("text")).toBe("本文");
    expect(await adapter.continuePublish!(account, state)).toEqual({ state });
    expect(await adapter.continuePublish!(account, state)).toEqual({ done: { externalPostId: "post-1", url: "https://www.threads.com/p/1" } });
  });

  it("Threads が動画を断ったら、やり直さず（permanent）、動画を選び直すよう知らせる", async () => {
    mockFetch([{ body: { status: "ERROR", error_message: "bad video" } }]);
    const err = await createThreadsAdapter()
      .continuePublish!(account, { kind: "single", id: "c1", video: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(SnsPublishError);
    expect(err.kind).toBe("permanent");
    expect(err.userMessage).toContain("動画を受け付けませんでした");
  });
});

describe("Instagram のリール", () => {
  const account = { externalId: "17841400000000000", accessToken: "ig-token" };
  it("REELS のコンテナを video_url で作り、フィードにも出す。準備できたら公開する", async () => {
    const calls = mockFetch([{ body: { id: "c9" } }, { body: { status_code: "FINISHED" } }, { body: { id: "media-9" } }, { body: { permalink: "https://www.instagram.com/reel/9" } }]);
    const adapter = createInstagramAdapter();
    const state = await adapter.startPublishVideo!(account, "キャプション", video);
    expect(state).toEqual({ kind: "single", id: "c9", video: true });
    expect(calls[0].url.pathname).toContain(`/${account.externalId}/media`);
    expect(Object.fromEntries(calls[0].body!)).toMatchObject({ media_type: "REELS", video_url: video.url, caption: "キャプション", share_to_feed: "true" });
    expect(await adapter.continuePublish!(account, state)).toEqual({ done: { externalPostId: "media-9", url: "https://www.instagram.com/reel/9" } });
  });
});

describe("Facebook ページのリール", () => {
  const account = { externalId: "page-1", accessToken: "page-token" };
  const adapter = () => createFacebookAdapter(() => "app-secret");
  const status = (uploading: string, processing = "not_started", publishing = "not_started", extra: object = {}) => ({
    body: { status: { video_status: "processing", uploading_phase: { status: uploading }, processing_phase: { status: processing }, publishing_phase: { status: publishing }, ...extra } },
  });

  it("受付 → Facebook に取りに来てもらう（Authorization: OAuth と file_url。トークンを URL に載せない）→ 状態を返す", async () => {
    const calls = mockFetch([{ body: { video_id: "v1", upload_url: "https://rupload.facebook.com/video-upload/v24.0/v1" } }, { body: { success: true } }]);
    const state = await adapter().startPublishVideo!(account, "本文", video);
    expect(state).toEqual({ kind: "fb_reel", videoId: "v1", text: "本文" });
    expect(calls[0].url.pathname).toBe("/v24.0/page-1/video_reels");
    expect(calls[0].body?.get("upload_phase")).toBe("start");
    expect(calls[0].url.searchParams.get("appsecret_proof")).toBeTruthy();
    expect(calls[1].url.toString()).toBe("https://rupload.facebook.com/video-upload/v24.0/v1");
    expect(calls[1].headers.get("authorization")).toBe("OAuth page-token");
    expect(calls[1].headers.get("file_url")).toBe(video.url);
    expect(calls[1].url.searchParams.get("access_token")).toBeNull();
  });

  it("取り込み中は待つ。終わったら本文を付けて公開を頼み、公開まで済んだら投稿の ID（動画の ID）と URL を返す", async () => {
    const start: PrepareState = { kind: "fb_reel", videoId: "v1", text: "本文" };
    const calls = mockFetch([
      status("in_progress"),
      status("complete"),
      { body: { success: true } },
      status("complete", "complete", "in_progress"),
      status("complete", "complete", "complete"),
      { body: { permalink_url: "https://www.facebook.com/reel/v1" } },
    ]);
    const a = adapter();
    expect(await a.continuePublish!(account, start)).toEqual({ state: start });
    const afterFinish = await a.continuePublish!(account, start);
    expect(afterFinish).toEqual({ state: { ...start, finished: true } });
    const finish = calls[2];
    expect(Object.fromEntries(finish.body!)).toMatchObject({ upload_phase: "finish", video_id: "v1", video_state: "PUBLISHED", description: "本文" });
    const finished = (afterFinish as { state: PrepareState }).state;
    expect(await a.continuePublish!(account, finished)).toEqual({ state: finished });
    expect(await a.continuePublish!(account, finished)).toEqual({ done: { externalPostId: "v1", url: "https://www.facebook.com/reel/v1" } });
  });

  it("どこかの段階が error なら、やり直さない（permanent）。公開を頼む途中で切れたら、二重にしない（unknown）", async () => {
    mockFetch([status("complete", "error", "not_started", { processing_phase: { status: "error", errors: [{ message: "too short" }] } })]);
    const e1 = await adapter()
      .continuePublish!(account, { kind: "fb_reel", videoId: "v1", text: "" })
      .catch((e) => e);
    expect(e1.kind).toBe("permanent");
    expect(e1.userMessage).toContain("too short");

    mockFetch((c) => {
      if (c.method === "POST") throw new TypeError("fetch failed");
      return status("complete");
    });
    const e2 = await adapter()
      .continuePublish!(account, { kind: "fb_reel", videoId: "v1", text: "" })
      .catch((e) => e);
    expect(e2.kind).toBe("unknown");
  });

  it("壊れた途中の記録は読まない", async () => {
    mockFetch([]);
    await expect(adapter().continuePublish!(account, { kind: "single", id: "x" })).rejects.toMatchObject({ kind: "permanent" });
  });
});

describe("X の動画（W2 の確かめまで、SNS.x.video は false のまま）", () => {
  const account = { externalId: "x1", accessToken: "x-token" };
  // FormData の中身も見られる偽物
  function xFetch(responses: { status?: number; body: unknown }[]) {
    const calls: { url: URL; method: string; form: FormData | null; json: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        calls.push({ url: new URL(String(input)), method: init?.method ?? "GET", form: body instanceof FormData ? body : null, json: typeof body === "string" ? JSON.parse(body) : null });
        const r = responses.shift() ?? { status: 500, body: {} };
        return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
      }),
    );
    return calls;
  }
  const adapter = () => createXAdapter(() => ({ clientId: "c", clientSecret: "s", redirectUri: "https://localhost/cb" }));
  const big = (n: number) => ({ ...video, sizeBytes: n, readRange: async (s: number, e: number) => new Uint8Array(e - s) });

  it("initialize → 5MB ずつ append（segment_index は 0 から）→ finalize。処理中なら状態を返し、済んだら投稿する", async () => {
    const size = 12 * 1024 * 1024;
    const calls = xFetch([
      { body: { data: { id: "media-1" } } },
      { body: {} },
      { body: {} },
      { body: {} },
      { body: { data: { processing_info: { state: "pending", check_after_secs: 5 } } } },
      { body: { data: { processing_info: { state: "in_progress" } } } },
      { body: { data: { processing_info: { state: "succeeded" } } } },
      { body: { data: { id: "post-1" } } },
    ]);
    const a = adapter();
    const state = await a.startPublishVideo!(account, "本文", big(size));
    expect(state).toEqual({ kind: "x_video", mediaId: "media-1", text: "本文" });
    expect(calls[0].json).toEqual({ media_type: "video/mp4", total_bytes: size, media_category: "tweet_video" });
    const appends = calls.slice(1, 4);
    expect(appends.map((c) => c.url.pathname)).toEqual(Array(3).fill("/2/media/upload/media-1/append"));
    expect(appends.map((c) => c.form?.get("segment_index"))).toEqual(["0", "1", "2"]);
    expect(appends.map((c) => (c.form?.get("media") as Blob).size)).toEqual([5 * 1024 * 1024, 5 * 1024 * 1024, 2 * 1024 * 1024]);
    expect(calls[4].url.pathname).toBe("/2/media/upload/media-1/finalize");
    expect(await a.continuePublish!(account, state)).toEqual({ state });
    expect(calls[5].url.searchParams.get("command")).toBe("STATUS");
    expect(await a.continuePublish!(account, state)).toEqual({ done: { externalPostId: "post-1", url: "https://x.com/i/web/status/post-1" } });
    expect(calls[7].json).toEqual({ text: "本文", media: { media_ids: ["media-1"] } });
  });

  it("finalize で処理が要らなければ、次の確かめで STATUS を呼ばずに投稿する。failed は permanent", async () => {
    const calls = xFetch([{ body: { data: { id: "m2" } } }, { body: {} }, { body: { data: {} } }, { body: { data: { id: "post-2" } } }]);
    const a = adapter();
    const state = await a.startPublishVideo!(account, "本文", big(100));
    expect(await a.continuePublish!(account, state)).toMatchObject({ done: { externalPostId: "post-2" } });
    expect(calls.some((c) => c.url.searchParams.get("command") === "STATUS")).toBe(false);

    xFetch([{ body: { data: { processing_info: { state: "failed", error: { message: "InvalidMedia" } } } } }]);
    await expect(a.continuePublish!(account, { kind: "x_video", mediaId: "m3", text: "" })).rejects.toMatchObject({ kind: "permanent" });
  });
});
