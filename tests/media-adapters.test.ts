// 画像つきの送信（Threads の画像・カルーセル、X のメディア）。HTTP はすべてモックし、本物の SNS には送らない（docs/architecture.md の 4.18）
import { afterEach, describe, expect, it, vi } from "vitest";
import { createThreadsAdapter } from "@/lib/sns/adapters/threads";
import { SnsPublishError, type PublishImage } from "@/lib/sns/adapters/types";
import { createXAdapter } from "@/lib/sns/adapters/x";
import { X_PRICE_USD } from "@/lib/sns/x/pricing";

const account = { externalId: "987", accessToken: "token" };
const config = () => ({ clientId: "c", clientSecret: "s", redirectUri: "https://localhost:3100/sns/x/callback" });

type Reply = { body: unknown; status?: number };

function scriptedFetch(replies: Reply[]) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void input;
    void init;
    const r = replies.shift();
    if (!r) throw new Error("想定より多く呼ばれました");
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const image = (n: number, altText = ""): PublishImage => ({
  url: `https://storage.example/post-media/u/${n}.jpg?token=t${n}`,
  altText,
  load: vi.fn(async () => new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9])),
});

const params = (init?: RequestInit) => init?.body as URLSearchParams;

describe("Threads", () => {
  it("1 枚は IMAGE のコンテナ（本文と代わりの文つき）。準備ができてから公開する", async () => {
    const fetch = scriptedFetch([
      { body: { id: "c1" } },
      { body: { status: "IN_PROGRESS" } },
      { body: { status: "FINISHED" } },
      { body: { id: "m1" } },
      { body: { permalink: "https://www.threads.com/@a/post/1" } },
    ]);
    const r = await createThreadsAdapter({ sleep: async () => {} }).publishText(account, "本文", [image(1, "グラフの画面")]);
    expect(r.externalPostId).toBe("m1");
    const p = params(fetch.mock.calls[0][1]);
    expect(p.get("media_type")).toBe("IMAGE");
    expect(p.get("image_url")).toBe(image(1).url);
    expect(p.get("text")).toBe("本文");
    expect(p.get("alt_text")).toBe("グラフの画面");
    expect(params(fetch.mock.calls[3][1]).get("creation_id")).toBe("c1");
  });

  it("2 枚以上はカルーセル: 1 枚ずつのコンテナ（本文なし）→ まとめたコンテナ（本文つき）→ 公開", async () => {
    const fetch = scriptedFetch([
      { body: { id: "i1" } },
      { body: { id: "i2" } },
      { body: { id: "car" } },
      { body: { status: "FINISHED" } },
      { body: { id: "m2" } },
      { body: {} },
    ]);
    await createThreadsAdapter({ sleep: async () => {} }).publishText(account, "本文", [image(1, "1 枚目"), image(2)]);
    const [first, second, carousel] = [0, 1, 2].map((i) => params(fetch.mock.calls[i][1]));
    expect(first.get("is_carousel_item")).toBe("true");
    expect(first.get("text")).toBeNull();
    expect(first.get("alt_text")).toBe("1 枚目");
    expect(second.get("alt_text")).toBeNull();
    expect(carousel.get("media_type")).toBe("CAROUSEL");
    expect(carousel.get("children")).toBe("i1,i2");
    expect(carousel.get("text")).toBe("本文");
  });

  it("画像の準備が長引いたら公開せず、やり直す（二重にならない）", async () => {
    scriptedFetch([{ body: { id: "c1" } }, ...Array.from({ length: 3 }, () => ({ body: { status: "IN_PROGRESS" } }))]);
    const e = await createThreadsAdapter({ sleep: async () => {}, maxImagePolls: 3 })
      .publishText(account, "本文", [image(1)])
      .catch((x) => x);
    expect(e).toBeInstanceOf(SnsPublishError);
    expect(e.kind).toBe("retryable");
  });
});

describe("X", () => {
  it("画像を上げ（代わりの文があれば付け）、media_ids をつけて投稿する", async () => {
    const fetch = scriptedFetch([
      { body: { data: { id: "md1" } } },
      { body: { data: {} } },
      { body: { data: { id: "md2" } } },
      { body: { data: { id: "p1" } } },
    ]);
    const images = [image(1, "グラフの画面"), image(2)];
    const r = await createXAdapter(config).publishText(account, "本文", images);
    expect(r).toEqual({ externalPostId: "p1", url: "https://x.com/i/web/status/p1" });
    expect(String(fetch.mock.calls[0][0])).toBe("https://api.x.com/2/media/upload");
    const form = fetch.mock.calls[0][1]?.body as FormData;
    expect(form.get("media_category")).toBe("tweet_image");
    expect(form.get("media")).toBeInstanceOf(Blob);
    expect(String(fetch.mock.calls[1][0])).toBe("https://api.x.com/2/media/metadata");
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ id: "md1", metadata: { alt_text: { text: "グラフの画面" } } });
    expect(String(fetch.mock.calls[2][0])).toBe("https://api.x.com/2/media/upload");
    expect(JSON.parse(String(fetch.mock.calls[3][1]?.body))).toEqual({ text: "本文", media: { media_ids: ["md1", "md2"] } });
  });

  it("画像を上げる段階の失敗は、まだ投稿していないので unknown にしない", async () => {
    scriptedFetch([{ body: { title: "Service Unavailable" }, status: 503 }]);
    const e = await createXAdapter(config).publishText(account, "本文", [image(1)]).catch((x) => x);
    expect(e).toBeInstanceOf(SnsPublishError);
    expect(e.kind).toBe("retryable");
  });

  it("画像の権限がないときは、接続切れにせず、つなぎ直しを案内する", async () => {
    scriptedFetch([{ body: { title: "Forbidden", detail: "You are not permitted to perform this action. Missing scope media.write" }, status: 403 }]);
    const e = await createXAdapter(config).publishText(account, "本文", [image(1)]).catch((x) => x);
    expect(e.kind).toBe("permanent");
    expect(e.userMessage).toContain("つなぎ直して");
  });

  it("費用: 代わりの文のある画像 1 枚ごとに media metadata の分を足す", () => {
    const x = createXAdapter(config);
    expect(x.publishCost!("本文", [image(1, "a"), image(2), image(3, "c")]).costUsd).toBeCloseTo(X_PRICE_USD.post + 2 * X_PRICE_USD.media_metadata);
    expect(x.publishCost!("https://example.com", [image(1)])).toEqual({ operation: "post_with_url", costUsd: X_PRICE_USD.post_with_url });
  });
});
