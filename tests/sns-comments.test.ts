// SNS のコメントの読み方と権限（docs/architecture.md の 4.70）。本物の SNS は呼ばない（fetch を差し替える）
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { classifyGraphError, CommentsError, facebookComments, instagramComments, MAX_BODY_CHARS, threadsComments } from "@/lib/sns/comments/fetchers";
import { FRESH_INTERVAL_MS, LATER_INTERVAL_MS, nextCheckAt, SLACK_MS } from "@/lib/sns/comments/import";
import { digestMessage } from "@/lib/sns/comments/digest";
import { agoLabel, buildPostComments, newCommentSummary, SEEN_GRACE_MS } from "@/lib/sns/comments/view";
import { enabledCommentScopes, hasCommentsScope, requestedScopes, withCommentsScope } from "@/lib/sns/comments/scopes";

const account = { externalId: "me-id", accessToken: "tok", handle: "me" };

function fakeFetch(pages: Record<string, unknown>[], status = 200) {
  const calls: URL[] = [];
  const impl = vi.fn(async (input: URL | RequestInfo) => {
    calls.push(new URL(String(input)));
    const body = pages[Math.min(calls.length - 1, pages.length - 1)];
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("権限", () => {
  it("SNS_COMMENTS に入れた SNS だけ、コメントの権限を足す。数字の権限とも合わせられる", () => {
    expect(withCommentsScope("threads", ["threads_basic"], "")).toEqual(["threads_basic"]);
    expect(withCommentsScope("threads", ["threads_basic"], "threads, instagram")).toEqual(["threads_basic", "threads_read_replies"]);
    expect(withCommentsScope("x", ["tweet.read"], "x")).toEqual(["tweet.read"]);
    expect(withCommentsScope("facebook", ["pages_read_engagement"], "facebook")).toEqual(["pages_read_engagement", "pages_read_user_content"]);
    expect(requestedScopes("instagram", ["instagram_business_basic"], { insights: "instagram", comments: "instagram" })).toEqual([
      "instagram_business_basic",
      "instagram_business_manage_insights",
      "instagram_business_manage_comments",
    ]);
    expect(enabledCommentScopes("threads,x")).toEqual({ threads: "threads_read_replies" });
    expect(hasCommentsScope("threads", ["threads_read_replies"])).toBe(true);
    expect(hasCommentsScope("instagram", ["instagram_business_basic"])).toBe(false);
  });
});

describe("次に読む時刻", () => {
  const now = new Date("2026-11-14T00:00:00Z");
  it("送ってから 2 日までは 3 時間ごと、そのあとは 12 時間ごと。続けて 3 回失敗したら 12 時間", () => {
    expect(nextCheckAt(now, new Date(now.getTime() - 3600_000)).getTime() - now.getTime()).toBe(FRESH_INTERVAL_MS - SLACK_MS);
    expect(nextCheckAt(now, new Date(now.getTime() - 3 * 86_400_000)).getTime() - now.getTime()).toBe(LATER_INTERVAL_MS - SLACK_MS);
    expect(nextCheckAt(now, new Date(now.getTime() - 3600_000), 3).getTime() - now.getTime()).toBe(LATER_INTERVAL_MS - SLACK_MS);
  });
});

describe("失敗の分け方", () => {
  it("権限・回数の上限・投稿がない・その他", () => {
    expect(classifyGraphError(400, { error: { code: 10 } })).toBe("permission");
    expect(classifyGraphError(400, { error: { code: 200 } })).toBe("permission");
    expect(classifyGraphError(403, null)).toBe("permission");
    expect(classifyGraphError(400, { error: { code: 4 } })).toBe("rate");
    expect(classifyGraphError(400, { error: { code: 613 } })).toBe("rate");
    expect(classifyGraphError(400, { error: { code: 100, error_subcode: 33 } })).toBe("gone");
    expect(classifyGraphError(500, { error: { code: 1 } })).toBe("other");
  });
});

describe("Threads", () => {
  it("返信への返信の親・自分のもの・隠したものを読み分け、本文を上限で切る。続きのページもたどる", async () => {
    const { impl, calls } = fakeFetch([
      {
        data: [
          { id: "r1", text: "こんにちは", username: "ann", timestamp: "2026-11-14T01:00:00+0000", replied_to: { id: "post1" } },
          { id: "r2", text: "ありがとう", username: "me", timestamp: "2026-11-14T02:00:00+0000", replied_to: { id: "r1" } },
          { id: "r3", text: "隠した", username: "bad", timestamp: "2026-11-14T02:00:00+0000", hide_status: "HIDDEN" },
        ],
        paging: { next: "https://graph.threads.com/v1.0/post1/conversation?after=abc&access_token=tok" },
      },
      { data: [{ id: "r4", text: "あ".repeat(MAX_BODY_CHARS + 10), username: "long", timestamp: "2026-11-14T03:00:00+0000" }] },
    ]);
    const res = await threadsComments.list(account, "post1", { lastCount: null, fetchImpl: impl });
    expect(res.kind).toBe("listed");
    if (res.kind !== "listed") return;
    expect(res.complete).toBe(true);
    expect(res.comments.map((c) => [c.externalId, c.parentExternalId, c.authorName, c.isOwn])).toEqual([
      ["r1", null, "@ann", false],
      ["r2", "r1", "@me", true],
      ["r4", null, "@long", false],
    ]);
    expect([...res.comments[2].body]).toHaveLength(MAX_BODY_CHARS);
    expect(calls[0].pathname).toBe("/v1.0/post1/conversation");
    expect(calls).toHaveLength(2);
  });

  it("続きのページが別の場所を指していたら、たどらずに途中までにする（トークンを送らない）", async () => {
    const { impl, calls } = fakeFetch([{ data: [{ id: "r1", text: "a", username: "a", timestamp: "2026-11-14T01:00:00+0000" }], paging: { next: "https://evil.example.com/x" } }]);
    const res = await threadsComments.list(account, "post1", { lastCount: null, fetchImpl: impl });
    expect(res.kind === "listed" && res.complete).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("SNS のエラーは、種類つきの CommentsError にする", async () => {
    const { impl } = fakeFetch([{ error: { message: "rate", code: 17 } }], 400);
    await expect(threadsComments.list(account, "post1", { lastCount: null, fetchImpl: impl })).rejects.toMatchObject({ kind: "rate" });
    await expect(threadsComments.list(account, "post1", { lastCount: null, fetchImpl: impl })).rejects.toBeInstanceOf(CommentsError);
  });
});

describe("Instagram", () => {
  it("数が前と同じなら、一覧は読まない", async () => {
    const { impl, calls } = fakeFetch([{ comments_count: 3 }]);
    expect(await instagramComments.list(account, "m1", { lastCount: 3, fetchImpl: impl })).toEqual({ kind: "unchanged", count: 3 });
    expect(calls).toHaveLength(1);
  });

  it("数が変わったら一覧を読み、返信をたたむ。隠したものは入れない。返信の続きがあれば途中までにする", async () => {
    const { impl, calls } = fakeFetch([
      { comments_count: 4 },
      {
        data: [
          {
            id: "c1",
            text: "すてき",
            username: "tomo",
            timestamp: "2026-11-14T01:00:00+0000",
            replies: { data: [{ id: "c2", text: "どうも", from: { id: "me-id", username: "me" }, timestamp: "2026-11-14T02:00:00+0000" }], paging: { next: "https://graph.instagram.com/x" } },
          },
          { id: "c3", text: "隠した", username: "x", timestamp: "2026-11-14T01:00:00+0000", hidden: true },
        ],
      },
    ]);
    const res = await instagramComments.list(account, "m1", { lastCount: 1, fetchImpl: impl });
    expect(res.kind).toBe("listed");
    if (res.kind !== "listed") return;
    expect(res.count).toBe(4);
    expect(res.complete).toBe(false);
    expect(res.comments.map((c) => [c.externalId, c.parentExternalId, c.authorName, c.isOwn])).toEqual([
      ["c1", null, "@tomo", false],
      ["c2", "c1", "@me", true],
    ]);
    expect(calls[1].pathname).toBe("/v24.0/m1/comments");
  });
});

describe("Facebook", () => {
  it("ページのトークンに appsecret_proof を付けて読み、ページ自身のコメントに印を付ける。名前がなければ空", async () => {
    const { impl, calls } = fakeFetch([
      {
        data: [
          { id: "f1", message: "行きます", created_time: "2026-11-14T01:00:00+0000", from: { id: "u1", name: "山田" } },
          { id: "f2", message: "お待ちしてます", created_time: "2026-11-14T02:00:00+0000", from: { id: "me-id", name: "店" }, parent: { id: "f1" } },
          { id: "f3", message: "名前なし", created_time: "2026-11-14T03:00:00+0000" },
        ],
      },
    ]);
    const res = await facebookComments(() => "secret").list(account, "page_post", { lastCount: null, fetchImpl: impl });
    expect(res.kind === "listed" && res.comments.map((c) => [c.externalId, c.parentExternalId, c.authorName, c.isOwn])).toEqual([
      ["f1", null, "山田", false],
      ["f2", "f1", "店", true],
      ["f3", null, "", false],
    ]);
    expect(calls[0].searchParams.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0].searchParams.get("filter")).toBe("stream");
  });
});

describe("AI に送らない", () => {
  it("AI の指示文を組み立てるファイル（src/lib/ai/）は、コメントの表を読まない", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src/lib/ai"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/sns_comments|sns\/comments/);
  });
});

describe("画面の組み立て", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  const row = (id: string, target: string, extra: Record<string, unknown> = {}) => ({
    id,
    post_target_id: target,
    sns: "threads",
    parent_external_id: null,
    author_name: "@a",
    body: "b",
    is_own: false,
    commented_at: "2026-11-14T10:00:00Z",
    seen_at: null,
    ...extra,
  });
  const target = (id: string, sns: "threads" | "x", publishedAt: string, extra: Record<string, unknown> = {}) => ({ id, postId: `p-${id}`, sns, title: id, publishedAt, url: null, likes: null, replies: null, ...extra });

  it("新しいコメントのある投稿を上に、古い順に並べ、自分のものは数えない。見てから 10 分は新しいの印を残す。X は返信の数だけ", () => {
    const views = buildPostComments(
      [target("t1", "threads", "2026-11-14T00:00:00Z"), target("t2", "threads", "2026-11-10T00:00:00Z"), target("x1", "x", "2026-11-13T00:00:00Z", { replies: 5, likes: 3 }), target("x2", "x", "2026-11-13T00:00:00Z", { replies: 0 })],
      [
        row("a", "t1", { seen_at: new Date(now.getTime() - SEEN_GRACE_MS - 1).toISOString() }),
        row("b", "t1", { is_own: true, parent_external_id: "ext-a", commented_at: "2026-11-14T09:00:00Z" }),
        row("c", "t2", { seen_at: new Date(now.getTime() - 60_000).toISOString() }),
      ],
      now,
    );
    expect(views.map((v) => [v.targetId, v.count, v.newCount])).toEqual([
      ["t2", 1, 1],
      ["t1", 1, 0],
      ["x1", 5, 0],
    ]);
    expect(views[1].comments.map((c) => [c.id, c.isReply, c.isOwn])).toEqual([
      ["b", true, true],
      ["a", false, false],
    ]);
  });

  it("概要の帯は、まだ見ていないものだけを SNS ごとに数える", () => {
    expect(
      newCommentSummary([
        { sns: "threads", is_own: false, seen_at: null },
        { sns: "instagram", is_own: false, seen_at: null },
        { sns: "threads", is_own: true, seen_at: null },
        { sns: "threads", is_own: false, seen_at: "2026-11-14T00:00:00Z" },
      ]),
    ).toEqual({ total: 2, bySns: { threads: 1, instagram: 1 } });
  });

  it("いつ書かれたか", () => {
    expect(agoLabel("2026-11-14T11:59:30Z", now)).toBe("たった今");
    expect(agoLabel("2026-11-14T11:15:00Z", now)).toBe("45 分前");
    expect(agoLabel("2026-11-14T09:00:00Z", now)).toBe("3 時間前");
    expect(agoLabel("2026-11-13T09:00:00Z", now)).toBe("昨日");
    expect(agoLabel("2026-11-10T09:00:00Z", now)).toBe("11/10");
  });

  it("まとめの通知: いちばん多いプロジェクトを開き、ほかのプロジェクトの数を添える", () => {
    expect(
      digestMessage([
        { projectId: "p1", projectName: "A", bySns: { threads: 1 }, total: 1 },
        { projectId: "p2", projectName: "こむぎ日和", bySns: { threads: 2, instagram: 1 }, total: 3 },
      ]),
    ).toEqual({ title: "新しいコメント 4 件", body: "こむぎ日和: Threads 2・Instagram 1（ほか 1 つのプロジェクト）", url: "/projects/p2/comments", tag: "comments" });
    expect(digestMessage([])).toBeNull();
  });
});
