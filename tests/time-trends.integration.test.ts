// 時間帯ごとの傾向の DB の関数（posting_time_trends。数字の段 4）: 日本時間での時間帯の分け方、直近 90 日、
// 閲覧はいちばん新しい日の views（なければ手で入れた数）、ボット・重複のクリックは数えない、他人・ログインしていない人には何も返さない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadTimeTrends } from "@/lib/metrics/time-trends";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("テストではクライアントを渡す");
  },
}));

const admin = adminClient();
const TODAY = "2026-10-30";
const jst = (s: string) => new Date(`${s}+09:00`).toISOString();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let bobProject: string;

// 送った配信先を、送った日時（日本時間）を決めて作る
async function sent(sns: string, at: string) {
  const { data: p } = await admin.from("posts").insert({ owner_id: aliceId, project_id: projectId, body: "本文", planned_at: jst(at), status: "scheduled" }).select("id").single();
  const { data: t } = await admin.from("post_targets").insert({ owner_id: aliceId, post_id: p!.id, sns, status: "published", published_at: jst(at) }).select("id").single();
  return t!.id as string;
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "時間帯" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "他人" }).select("id").single()).data!.id;

  // 閲覧: 朝の境目（4:59 は夜、5:00 は朝、10:59 は朝、11:00 は昼）
  const night1 = await sent("x", "2026-10-20T04:59:00");
  const morning1 = await sent("x", "2026-10-20T05:00:00");
  const morning2 = await sent("x", "2026-10-21T10:59:00");
  const noon1 = await sent("x", "2026-10-21T11:00:00");
  const note1 = await sent("note", "2026-10-22T21:30:00");
  // 91 日前は入れない
  const old = await sent("x", "2026-07-31T09:00:00");
  await admin.from("post_metrics").insert([
    { post_target_id: night1, owner_id: aliceId, day_index: 1, values: { views: 100 } },
    { post_target_id: morning1, owner_id: aliceId, day_index: 1, values: { views: 10 } },
    // いちばん新しい日の views を使う
    { post_target_id: morning1, owner_id: aliceId, day_index: 3, values: { views: 50 } },
    { post_target_id: morning2, owner_id: aliceId, day_index: 1, values: { views: 70 } },
    { post_target_id: noon1, owner_id: aliceId, day_index: 1, values: { likes: 3 } },
    { post_target_id: old, owner_id: aliceId, day_index: 1, values: { views: 9999 } },
  ]);
  await admin.from("manual_post_metrics").insert({ post_target_id: note1, owner_id: aliceId, views: 40, reactions: 1 });

  // クリック: 夕 2 回・夜 1 回（ボットの 1 回と 91 日前の 1 回は数えない）
  const { data: link } = await admin
    .from("short_links")
    .insert({ owner_id: aliceId, project_id: projectId, code: `tb${Math.random().toString(36).slice(2, 10)}`, destination_url: "https://example.com/app", kind: "custom" })
    .select("id")
    .single();
  const click = (at: string, excluded: string | null = null) => ({ link_id: link!.id, clicked_at: jst(at), device: "ios", visitor_hash: `h-${at}`, excluded });
  await admin.from("link_clicks").insert([click("2026-10-25T16:00:00"), click("2026-10-26T19:59:00"), click("2026-10-26T20:00:00"), click("2026-10-27T17:00:00", "bot"), click("2026-07-31T17:00:00")]);
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("posting_time_trends", () => {
  it("日本時間の時間帯ごとに、閲覧の本数と平均・クリックの回数を返す", async () => {
    const { data, error } = await alice.rpc("posting_time_trends", { p_project_id: projectId, p_today: TODAY });
    expect(error).toBeNull();
    const by = Object.fromEntries(data!.map((r) => [r.band, { posts: Number(r.posts), avg: r.avg_views === null ? null : Number(r.avg_views), clicks: Number(r.clicks) }]));
    expect(by).toEqual({
      morning: { posts: 2, avg: 60, clicks: 0 },
      // 閲覧数の取れていない配信先（likes だけ）は数えない
      noon: { posts: 0, avg: null, clicks: 0 },
      evening: { posts: 0, avg: null, clicks: 2 },
      // 4:59 の X（100）と、手で入れた note（40）
      night: { posts: 2, avg: 70, clicks: 1 },
    });
  });

  it("少ない数では比べない（どの帯も 5 本・5 回に届いていない）", async () => {
    const t = await loadTimeTrends(projectId, alice, TODAY);
    expect(t.views).toEqual({ ready: false, need: 6 });
    expect(t.clicks).toEqual({ ready: false, need: 7 });
  });

  it("他人のプロジェクトを指しても何も返さない。ログインしていない人は呼べない", async () => {
    const { data, error } = await bob.rpc("posting_time_trends", { p_project_id: projectId, p_today: TODAY });
    expect(error).toBeNull();
    expect(data).toEqual([]);
    // 本人のプロジェクトでも、他人の投稿は混ざらない
    const own = await bob.rpc("posting_time_trends", { p_project_id: bobProject, p_today: TODAY });
    expect(own.data!.every((r) => Number(r.posts) === 0 && Number(r.clicks) === 0)).toBe(true);
    const anon = await anonClient().rpc("posting_time_trends", { p_project_id: projectId, p_today: TODAY });
    expect(anon.error?.code).toBe("42501");
    const band = await anonClient().rpc("time_band_of", { p_at: new Date().toISOString() });
    expect(band.error?.code).toBe("42501");
  });
});
