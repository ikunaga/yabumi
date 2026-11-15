// YouTube の再開できるアップロードと、送る直前の確かめ（docs/design/youtube.md の 3.・5.・6.）。
// HTTP はすべて偽の Google（fetch の差し替え）で、本物の YouTube・Google には送らない。動画は偽物（実装担当1 の PostVideo と同じ形）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createYouTubeAdapter,
  QUOTA_GLOBAL_MESSAGE,
  youtubeDescriptionProblem,
  youtubeTitleProblem,
  type YouTubeAdapterDeps,
  type YouTubeSettings,
  type YouTubeUploadRow,
  type YouTubeVideo,
} from "@/lib/sns/adapters/youtube";
import { SnsPublishError, type PrepareState } from "@/lib/sns/adapters/types";
import { consentHash } from "@/lib/sns/tiktok/send-check";
import { authorizeUrl, receivedFromRange, UPLOAD_CHUNK_BYTES, YOUTUBE_SCOPES } from "@/lib/sns/youtube/api";

const MB = 1024 * 1024;
const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=fake";
const account = { accessToken: "tok", externalId: "UC_channel" };
const target = { id: "11111111-1111-4111-8111-111111111111", rawText: "説明" };

const settings = (over: Partial<YouTubeSettings> = {}): YouTubeSettings => ({
  privacy_status: "unlisted",
  made_for_kids: false,
  synthetic_media: false,
  category_id: "22",
  consent_text_hash: consentHash("新しいパン", "説明"),
  consent_channel: "こむぎのパン",
  ...over,
});

function fakeVideo(size: number): YouTubeVideo & { reads: [number, number][] } {
  const reads: [number, number][] = [];
  return {
    mediaId: "m1",
    sizeBytes: size,
    mime: "video/mp4",
    durationMs: 30_000,
    width: 1080,
    height: 1920,
    aiGenerated: false,
    reads,
    async readRange(start, end) {
      if (start < 0 || end > size || start >= end) throw new RangeError("範囲が外れています");
      reads.push([start, end]);
      return new Uint8Array(end - start);
    },
  };
}

// 偽の Google。受け取ったバイト数を覚え、チャンクごとに 308、最後に 200 と動画の ID を返す
function fakeGoogle(opts: { total: number; channel?: { id: string; title: string }; lostLastAnswer?: boolean; sessionGone?: boolean; status5xx?: boolean } ) {
  let received = 0;
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.split("?")[0]}`);
    if (url.includes("/channels")) {
      const c = opts.channel ?? { id: "UC_channel", title: "こむぎのパン" };
      return new Response(JSON.stringify({ items: [{ id: c.id, snippet: { title: c.title, customUrl: "@komugi" } }] }), { status: 200 });
    }
    if (method === "POST" && url.includes("uploadType=resumable")) {
      return new Response(null, { status: 200, headers: { location: SESSION } });
    }
    if (method === "PUT" && url === SESSION) {
      if (opts.sessionGone) return new Response("", { status: 404 });
      if (opts.status5xx) return new Response(JSON.stringify({ error: { message: "backend" } }), { status: 503 });
      const range = new Headers(init?.headers).get("content-range") ?? "";
      if (range.startsWith("bytes */")) {
        if (received >= opts.total) return new Response(JSON.stringify({ id: "vid_ABC123" }), { status: 200 });
        return new Response(null, { status: 308, headers: received ? { range: `bytes=0-${received - 1}` } : {} });
      }
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range)!;
      received = Number(m[2]) + 1;
      if (received >= opts.total) {
        if (opts.lostLastAnswer) throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ id: "vid_ABC123" }), { status: 201 });
      }
      return new Response(null, { status: 308, headers: { range: `bytes=0-${received - 1}` } });
    }
    return new Response("not found", { status: 404 });
  });
  return { fetchMock, calls, received: () => received };
}

function deps(over: Partial<YouTubeAdapterDeps> & { video?: YouTubeVideo | null; s?: YouTubeSettings | null; title?: string } = {}) {
  let row: YouTubeUploadRow | null = null;
  const store = {
    saved: [] as YouTubeUploadRow[],
    get row() {
      return row;
    },
    set row(r: YouTubeUploadRow | null) {
      row = r;
    },
  };
  const d: YouTubeAdapterDeps = {
    config: () => ({ clientId: "id", clientSecret: "secret", redirectUri: "https://yabumi.app/sns/youtube/callback" }),
    loadTarget: async () => ({ ownerId: "owner", postId: "post", title: over.title ?? "新しいパン", settings: over.s === undefined ? settings() : over.s }),
    loadVideo: async () => (over.video === undefined ? fakeVideo(20 * MB) : over.video),
    reserveUpload: vi.fn(async () => "ok" as const),
    userDailyUploads: 5,
    loadUpload: async () => row,
    saveUpload: async (_id, _owner, r) => {
      row = r;
      store.saved.push(r);
    },
    clearUpload: async () => {
      if (!row?.videoId) row = null;
    },
    ...over,
  };
  return { d, store };
}

async function sendOnce(adapter: ReturnType<typeof createYouTubeAdapter>, state?: PrepareState) {
  const s = state ?? (await adapter.startPublish!(account, "説明", [], target));
  return adapter.continuePublish!(account, s);
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe("つなぐ", () => {
  it("同意の画面の URL: 2 つのスコープ・offline・毎回同意・PKCE（S256）・state", () => {
    const url = new URL(authorizeUrl({ clientId: "cid", clientSecret: "s", redirectUri: "https://yabumi.app/sns/youtube/callback" }, "st", "verifier"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(YOUTUBE_SCOPES.join(" "));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("include_granted_scopes")).toBeNull();
  });
});

describe("タイトルと説明の決まり", () => {
  it("タイトルは必須・100 字まで・< > なし。説明は 5,000 バイトまで・< > なし", () => {
    expect(youtubeTitleProblem("")).toMatch(/入れて/);
    expect(youtubeTitleProblem("あ".repeat(100))).toBeNull();
    expect(youtubeTitleProblem("あ".repeat(101))).toMatch(/100 字/);
    expect(youtubeTitleProblem("<b>")).toMatch(/< と >/);
    expect(youtubeDescriptionProblem("あ".repeat(1666))).toBeNull(); // 4,998 バイト
    expect(youtubeDescriptionProblem("あ".repeat(1667))).toMatch(/5,000 バイト/);
    expect(youtubeDescriptionProblem("a > b")).toMatch(/< と >/);
  });

  it("308 の Range から受け取られたバイト数を読む", () => {
    expect(receivedFromRange("bytes=0-8388607")).toBe(8 * MB);
    expect(receivedFromRange(null)).toBe(0);
  });
});

describe("再開できるアップロード", () => {
  it("割り当てを取ってからセッションを始め、8MB ずつ送って済んだら published（動画の ID と URL）", async () => {
    const g = fakeGoogle({ total: 20 * MB });
    vi.stubGlobal("fetch", g.fetchMock);
    const video = fakeVideo(20 * MB);
    const { d, store } = deps({ video });
    const adapter = createYouTubeAdapter(d);
    const r = await sendOnce(adapter);
    expect(r).toEqual({ done: { externalPostId: "vid_ABC123", url: "https://www.youtube.com/watch?v=vid_ABC123" } });
    expect(d.reserveUpload).toHaveBeenCalledTimes(1);
    expect(video.reads).toEqual([
      [0, UPLOAD_CHUNK_BYTES],
      [UPLOAD_CHUNK_BYTES, 2 * UPLOAD_CHUNK_BYTES],
      [2 * UPLOAD_CHUNK_BYTES, 20 * MB],
    ]);
    expect(store.row).toMatchObject({ videoId: "vid_ABC123", bytesSent: 20 * MB });
  });

  it("1 回の時間を超えたら、送った所までを覚えて準備中。次の回は受け取られた所から続きを送る", async () => {
    const g = fakeGoogle({ total: 20 * MB });
    vi.stubGlobal("fetch", g.fetchMock);
    let t = 0;
    const video = fakeVideo(20 * MB);
    // 1 回送るごとに 10 秒たつ（予算 15 秒なので、1 回目の呼び出しは 2 チャンクで止まる）
    const { d, store } = deps({ video, now: () => t, budgetMs: 15_000 });
    const origRead = video.readRange.bind(video);
    video.readRange = async (a, b) => {
      t += 10_000;
      return origRead(a, b);
    };
    const adapter = createYouTubeAdapter(d);
    const first = await sendOnce(adapter);
    expect("state" in first).toBe(true);
    expect(store.row?.bytesSent).toBe(2 * UPLOAD_CHUNK_BYTES);
    const second = await adapter.continuePublish!(account, (first as { state: PrepareState }).state);
    expect(second).toMatchObject({ done: { externalPostId: "vid_ABC123" } });
    // 続きは 16MB から（最初から送り直さない）
    expect(video.reads.at(-1)).toEqual([2 * UPLOAD_CHUNK_BYTES, 20 * MB]);
    expect(d.reserveUpload).toHaveBeenCalledTimes(1);
  });

  it("最後の答えが届かなくても、次の回に「どこまで受け取られたか」を聞いて済んだとわかる（二重に上げない）", async () => {
    const g = fakeGoogle({ total: 4 * MB, lostLastAnswer: true });
    vi.stubGlobal("fetch", g.fetchMock);
    const video = fakeVideo(4 * MB);
    const { d, store } = deps({ video });
    const adapter = createYouTubeAdapter(d);
    const state = await adapter.startPublish!(account, "説明", [], target);
    await expect(adapter.continuePublish!(account, state)).rejects.toMatchObject({ kind: "retryable" });
    // 送り直し: publisher は sns_container を消して startPublish からやり直す。セッションが残っているので始め直さない
    const again = await sendOnce(adapter);
    expect(again).toMatchObject({ done: { externalPostId: "vid_ABC123" } });
    expect(g.calls.filter((c) => c.startsWith("POST")).length).toBe(1);
    expect(video.reads.length).toBe(1);
    expect(store.row?.videoId).toBe("vid_ABC123");
    // 済んだあとにもう一度呼ばれても、上げ直さない
    const third = await sendOnce(adapter);
    expect(third).toMatchObject({ done: { externalPostId: "vid_ABC123" } });
    expect(g.calls.filter((c) => c.startsWith("POST")).length).toBe(1);
  });

  it("セッションが切れた（404）は、記録を消して retryable。次はセッションから始め直す（割り当てをもう 1 本取る）", async () => {
    const g = fakeGoogle({ total: 4 * MB, sessionGone: true });
    vi.stubGlobal("fetch", g.fetchMock);
    const { d, store } = deps({ video: fakeVideo(4 * MB) });
    const adapter = createYouTubeAdapter(d);
    await expect(sendOnce(adapter)).rejects.toMatchObject({ kind: "retryable" });
    expect(store.row).toBeNull();
    await expect(sendOnce(adapter)).rejects.toBeInstanceOf(SnsPublishError);
    expect(d.reserveUpload).toHaveBeenCalledTimes(2);
  });

  it("YouTube の 5xx は retryable、401 はつなぎ直し（auth）", async () => {
    vi.stubGlobal("fetch", fakeGoogle({ total: 4 * MB, status5xx: true }).fetchMock);
    const a = createYouTubeAdapter(deps({ video: fakeVideo(4 * MB) }).d);
    await expect(sendOnce(a)).rejects.toMatchObject({ kind: "retryable" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad", errors: [{ reason: "authError" }] } }), { status: 401 })));
    const b = createYouTubeAdapter(deps().d);
    await expect(b.startPublish!(account, "説明", [], target)).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("送る直前の確かめと割り当て", () => {
  it("同意のあとにタイトル・説明が変わった・チャンネルが違う・同意がない・動画がない は送らない（割り当ても取らない）", async () => {
    vi.stubGlobal("fetch", fakeGoogle({ total: MB }).fetchMock);
    const cases: [Parameters<typeof deps>[0], RegExp][] = [
      [{ title: "別のタイトル" }, /同意したあとに変わって/],
      [{ s: null }, /同意してから/],
      [{ video: null }, /動画がありません/],
      [{ s: settings({ consent_channel: "別のチャンネル" }) }, /チャンネルが、予約のときと違って/],
    ];
    for (const [over, message] of cases) {
      const { d } = deps(over);
      const a = createYouTubeAdapter(d);
      await expect(a.startPublish!(account, "説明", [], target)).rejects.toMatchObject({ kind: "permanent", userMessage: expect.stringMatching(message) });
      expect(d.reserveUpload).not.toHaveBeenCalled();
    }
  });

  it("割り当てに当たったら送らない（全体と利用者ごとで文が違う）。セッションも始めない", async () => {
    const g = fakeGoogle({ total: MB });
    vi.stubGlobal("fetch", g.fetchMock);
    for (const [verdict, message] of [
      ["global", QUOTA_GLOBAL_MESSAGE],
      ["user", "YouTube は 1 日 5 本まで送れます。明日送り直すか、手で投稿してください。"],
    ] as const) {
      const { d } = deps({ reserveUpload: vi.fn(async () => verdict) });
      await expect(createYouTubeAdapter(d).startPublish!(account, "説明", [], target)).rejects.toMatchObject({ kind: "permanent", userMessage: message });
    }
    expect(g.calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("Google の quotaExceeded・uploadLimitExceeded は、やり直さない", async () => {
    for (const reason of ["quotaExceeded", "uploadLimitExceeded"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) =>
          String(input).includes("/channels")
            ? new Response(JSON.stringify({ items: [{ id: "UC_channel", snippet: { title: "こむぎのパン" } }] }), { status: 200 })
            : new Response(JSON.stringify({ error: { message: "x", errors: [{ reason }] } }), { status: 403 }),
        ),
      );
      await expect(createYouTubeAdapter(deps().d).startPublish!(account, "説明", [], target)).rejects.toMatchObject({ kind: "permanent" });
    }
  });

  it("取り消しは YouTube Studio へ案内する（Y5）", async () => {
    await expect(createYouTubeAdapter(deps().d).deletePost(account, "vid")).rejects.toMatchObject({ userMessage: expect.stringMatching(/YouTube Studio/) });
  });
});
