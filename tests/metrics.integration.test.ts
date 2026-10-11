// 数字の画面の DB（docs/architecture.md の 4.22）: 手で入れる数字の権限、週ごとの合計、SNS ごとのクリック、クリックの多い投稿
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createShortLink, recordClick } from "@/lib/links/store";
import { anonClient, adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const STORE = "https://apps.apple.com/jp/app/id123456789";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

// 送信済みの配信先を、送った日時を決めて作る（送信の状態は利用者は書けないので、サーバーの権限で）
async function publishedPost(targets: { sns: string; publishedAt: string; title?: string }[], body = "本文") {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: body,
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: targets.map((t) => ({ sns: t.sns, title: t.title ?? null })),
  });
  if (error) throw error;
  const ids: Record<string, string> = {};
  for (const t of targets) {
    const { data } = await admin
      .from("post_targets")
      .update({ status: "published", published_at: t.publishedAt })
      .eq("post_id", postId!)
      .eq("sns", t.sns)
      .select("id")
      .single();
    ids[t.sns] = data!.id;
  }
  return { postId: postId!, ids };
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "数字" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("手で入れる数字", () => {
  it("本人の note・Substack の送信済みの配信先にだけ書ける。他人は読めない。数字以外の列は書き換えられない", async () => {
    const { ids } = await publishedPost([
      { sns: "note", publishedAt: daysAgo(1), title: "題" },
      { sns: "threads", publishedAt: daysAgo(1) },
    ]);
    expect((await alice.from("manual_post_metrics").insert({ post_target_id: ids.note, owner_id: aliceId, views: 120, reactions: 8 })).error).toBeNull();
    // 自動で送る SNS の配信先には書けない（RLS）
    expect((await alice.from("manual_post_metrics").insert({ post_target_id: ids.threads, owner_id: aliceId, views: 1 })).error).not.toBeNull();
    // 他人の配信先には書けず、読めない
    expect((await bob.from("manual_post_metrics").insert({ post_target_id: ids.note, owner_id: bobId, views: 1 })).error).not.toBeNull();
    expect((await bob.from("manual_post_metrics").select("*").eq("post_target_id", ids.note)).data).toEqual([]);
    // 数字は書き換えられ、持ち主は変えられない（列ごとの権限）
    expect((await alice.from("manual_post_metrics").update({ views: 150 }).eq("post_target_id", ids.note)).error).toBeNull();
    expect((await alice.from("manual_post_metrics").update({ owner_id: bobId }).eq("post_target_id", ids.note)).error?.code).toBe("42501");
    expect((await anonClient().from("manual_post_metrics").select("*").limit(1)).error?.code).toBe("42501");
  });
});

describe("週ごとの合計（DB の関数）", () => {
  it("送った回数と、手で入れた閲覧数を、直近 7 日とその前の 7 日に分けて数える。他人の分は数えない", async () => {
    const p = (await alice.from("projects").insert({ name: "週" }).select("id").single()).data!.id;
    const old = projectId;
    projectId = p;
    try {
      const a = await publishedPost([{ sns: "note", publishedAt: daysAgo(2), title: "a" }, { sns: "x", publishedAt: daysAgo(2) }]);
      const b = await publishedPost([{ sns: "substack", publishedAt: daysAgo(9), title: "b" }]);
      await publishedPost([{ sns: "threads", publishedAt: daysAgo(20) }]);
      await alice.from("manual_post_metrics").insert({ post_target_id: a.ids.note, owner_id: aliceId, views: 100 });
      await alice.from("manual_post_metrics").insert({ post_target_id: b.ids.substack, owner_id: aliceId, views: 40 });
      const { data } = await alice.rpc("weekly_post_totals", { p_project_id: p, p_today: today() });
      expect(data![0]).toEqual({ published_this_week: 2, published_last_week: 1, manual_views_this_week: 100, manual_views_last_week: 40 });
      expect((await bob.rpc("weekly_post_totals", { p_project_id: p, p_today: today() })).data![0]).toMatchObject({ published_this_week: 0 });
      expect((await anonClient().rpc("weekly_post_totals", { p_project_id: p, p_today: today() })).error?.code).toBe("42501");
    } finally {
      projectId = old;
    }
  });

  it("SNS ごとのクリックと、クリックの多い投稿", async () => {
    const p = (await alice.from("projects").insert({ name: "クリック" }).select("id").single()).data!.id;
    const old = projectId;
    projectId = p;
    try {
      const xLink = await createShortLink(admin, { ownerId: aliceId, projectId: p, destinationUrl: STORE, sns: "x", kind: "profile" });
      const post = await publishedPost([{ sns: "threads", publishedAt: daysAgo(1) }], "クリックの多い投稿");
      const postLink = await createShortLink(admin, { ownerId: aliceId, projectId: p, destinationUrl: STORE, sns: "threads", kind: "post", postTargetId: post.ids.threads });
      for (const [link, ip] of [[xLink.id, "203.0.113.1"], [xLink.id, "203.0.113.2"], [postLink.id, "203.0.113.3"]] as const) {
        await recordClick(admin, { linkId: link, ip, userAgent: IPHONE, device: "ios", country: "JP", excluded: null });
      }
      const { data: bySns } = await alice.rpc("link_clicks_by_sns", { p_project_id: p, p_today: today() });
      expect(Object.fromEntries(bySns!.map((r) => [r.sns, r.this_week]))).toEqual({ x: 2, threads: 1 });
      const { data: top } = await alice.rpc("top_posts_by_clicks", { p_project_id: p, p_today: today(), p_days: 30, p_limit: 5 });
      expect(top).toEqual([{ post_id: post.postId, clicks: 1 }]);
      expect((await bob.rpc("link_clicks_by_sns", { p_project_id: p, p_today: today() })).data).toEqual([]);
    } finally {
      projectId = old;
    }
  });
});
