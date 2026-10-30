// カレンダーの上の数字・右の列（src/lib/calendar/stats.ts）と、投稿をつくる画面の下の数字の帯（src/lib/posts/numbers.ts）:
// 月の境目（日本時間）、予約・投稿済み・下書き・送れなかったの数え方、前回送った投稿の選び方と数字の足し方、他人の投稿を数えないこと
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadCalendarStats } from "@/lib/calendar/stats";
import { loadPostNumbers } from "@/lib/posts/numbers";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));
// 読み込みには利用者の権限のクライアントを渡すので、cookie から作るクライアントは使わない
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("テストではクライアントを渡す");
  },
}));

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let aliceProject: string;
let bobProject: string;
// 数字の帯のテスト用（カレンダーの数と混ざらないよう、別のプロジェクト）
let numbersProject: string;

// 日本時間の "YYYY-MM-DDTHH:MM" を ISO にする
const jst = (s: string) => new Date(`${s}:00+09:00`).toISOString();

type Target = { sns: string; status?: "pending" | "published" | "failed"; publishedAt?: string };

// 投稿と配信先を作る（送信の状態は利用者は書けないので、サーバーの権限で）
async function post(ownerId: string, projectId: string, opts: { at: string | null; status: "draft" | "scheduled"; targets: Target[] }) {
  const { data: p, error } = await admin
    .from("posts")
    .insert({ owner_id: ownerId, project_id: projectId, body: "本文", planned_at: opts.at ? jst(opts.at) : null, status: opts.status })
    .select("id")
    .single();
  if (error) throw error;
  const { data: rows, error: e2 } = await admin
    .from("post_targets")
    .insert(
      opts.targets.map((t) => ({
        owner_id: ownerId,
        post_id: p.id,
        sns: t.sns,
        status: t.status ?? "pending",
        published_at: t.publishedAt ? jst(t.publishedAt) : null,
      })),
    )
    .select("id, sns");
  if (e2) throw e2;
  return { postId: p.id, ids: Object.fromEntries(rows.map((r) => [r.sns, r.id])) as Record<string, string> };
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  aliceProject = (await alice.from("projects").insert({ name: "カレンダーの数" }).select("id").single()).data!.id;
  numbersProject = (await alice.from("projects").insert({ name: "数字の帯" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "他人" }).select("id").single()).data!.id;

  // 9 月の予約（日本時間の 9/1 0:10 と 9/30 23:30 は 9 月。UTC ではそれぞれ 8/31 と 9/30）
  await post(aliceId, aliceProject, { at: "2026-09-01T00:10", status: "scheduled", targets: [{ sns: "x" }, { sns: "threads" }] });
  await post(aliceId, aliceProject, { at: "2026-09-30T23:30", status: "scheduled", targets: [{ sns: "x" }] });
  // 10/1 0:30（日本時間）は 10 月。UTC では 9/30 なので、UTC で切ると 9 月に入ってしまう
  await post(aliceId, aliceProject, { at: "2026-10-01T00:30", status: "scheduled", targets: [{ sns: "instagram" }] });
  // 9 月に送った投稿（予約の数には入れず、投稿済みに数える）
  await post(aliceId, aliceProject, { at: "2026-09-10T09:00", status: "scheduled", targets: [{ sns: "x", status: "published", publishedAt: "2026-09-10T09:00" }] });
  // 予約は 8 月だが、送ったのは日本時間の 9/1 0:05（投稿済みは送った日で数える）
  await post(aliceId, aliceProject, { at: "2026-08-31T23:50", status: "scheduled", targets: [{ sns: "threads", status: "published", publishedAt: "2026-09-01T00:05" }] });
  // 9 月に送れなかった投稿（いつのものでも「送れなかった」に数える。予約・投稿済みには入れない）
  await post(aliceId, aliceProject, { at: "2026-09-15T12:00", status: "scheduled", targets: [{ sns: "x", status: "failed" }] });
  // 下書き（日付の有無を問わない。予約の数には入れない）
  await post(aliceId, aliceProject, { at: "2026-09-20T12:00", status: "draft", targets: [{ sns: "x" }] });
  await post(aliceId, aliceProject, { at: null, status: "draft", targets: [] });
  // 他人の投稿（同じ 9 月）
  await post(bobId, bobProject, { at: "2026-09-05T12:00", status: "scheduled", targets: [{ sns: "x" }] });
  await post(bobId, bobProject, { at: null, status: "draft", targets: [] });
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("カレンダーの数字", () => {
  it("月の境目は日本時間で切り、予約・投稿済み・下書き・送れなかったを分けて数える", async () => {
    const sep = await loadCalendarStats(aliceProject, "2026-09", alice);
    expect(sep.scheduled).toBe(2);
    expect(sep.posted).toBe(2);
    expect(sep.drafts).toBe(2);
    expect(sep.failed).toBe(1);
    // SNS ごとは、この月に予定した投稿の予約と投稿済み（送れなかったもの・下書き・送った日だけ 9 月のものは入れない）。多い順
    expect(sep.bySns).toEqual([
      { sns: "x", count: 3 },
      { sns: "threads", count: 1 },
    ]);

    const oct = await loadCalendarStats(aliceProject, "2026-10", alice);
    expect(oct.scheduled).toBe(1);
    expect(oct.posted).toBe(0);
    expect(oct.bySns).toEqual([{ sns: "instagram", count: 1 }]);

    const aug = await loadCalendarStats(aliceProject, "2026-08", alice);
    expect(aug.scheduled).toBe(0);
    expect(aug.posted).toBe(0);
    // 8 月に予定して 9 月に送った投稿は、8 月の SNS ごとに数える
    expect(aug.bySns).toEqual([{ sns: "threads", count: 1 }]);
  });

  it("他人の投稿は数えない（他人のプロジェクトを指しても 0）", async () => {
    const bobs = await loadCalendarStats(bobProject, "2026-09", bob);
    expect(bobs).toEqual({ scheduled: 1, posted: 0, drafts: 1, failed: 0, bySns: [{ sns: "x", count: 1 }] });
    const peek = await loadCalendarStats(aliceProject, "2026-09", bob);
    expect(peek).toEqual({ scheduled: 0, posted: 0, drafts: 0, failed: 0, bySns: [] });
  });
});

describe("投稿をつくる画面の下の数字", () => {
  it("送った投稿がなければ出さない", async () => {
    expect(await loadPostNumbers(numbersProject, {}, alice)).toBeNull();
  });

  it("いちばん最近送った投稿を選び、数字がなければ出さない（古い投稿の数字に戻らない）", async () => {
    const older = await post(aliceId, numbersProject, { at: "2026-09-01T09:00", status: "scheduled", targets: [{ sns: "x", status: "published", publishedAt: "2026-09-01T09:00" }] });
    await admin.from("post_metrics").insert({ post_target_id: older.ids.x, owner_id: aliceId, day_index: 1, values: { views: 10, likes: 1 } });
    // 予約は古いが、送ったのはこちらが新しい
    const newer = await post(aliceId, numbersProject, {
      at: "2026-08-20T09:00",
      status: "scheduled",
      targets: [
        { sns: "x", status: "published", publishedAt: "2026-09-05T09:00" },
        { sns: "threads", status: "published", publishedAt: "2026-09-05T09:01" },
        { sns: "note", status: "published", publishedAt: "2026-09-05T10:00" },
      ],
    });
    expect(await loadPostNumbers(numbersProject, {}, alice)).toBeNull();

    // SNS の数字は配信先ごとに最新の日を使い、手で入れた note の数字を足す
    await admin.from("post_metrics").insert([
      { post_target_id: newer.ids.x, owner_id: aliceId, day_index: 1, values: { views: 100, likes: 5 } },
      { post_target_id: newer.ids.x, owner_id: aliceId, day_index: 3, values: { views: 300, likes: 9 } },
      { post_target_id: newer.ids.threads, owner_id: aliceId, day_index: 2, values: { views: 50 } },
    ]);
    await admin.from("manual_post_metrics").insert({ post_target_id: newer.ids.note, owner_id: aliceId, views: 20, reactions: 3 });
    const n = await loadPostNumbers(numbersProject, {}, alice);
    expect(n).toMatchObject({ kind: "last", postId: newer.postId, views: 370, likes: 12, clicks: null });
    // 送った日時は、いちばん早く送った SNS のもの
    expect(new Date(n!.publishedAt).toISOString()).toBe(jst("2026-09-05T09:00"));
    expect(n!.sns.sort()).toEqual(["note", "threads", "x"]);

    // 短縮リンクがあれば、押された回数（日ごとの合計）を足す
    const { data: link } = await admin
      .from("short_links")
      .insert({ owner_id: aliceId, project_id: numbersProject, code: `cs${Math.random().toString(36).slice(2, 10)}`, destination_url: "https://example.com/app", sns: "x", kind: "post", post_target_id: newer.ids.x })
      .select("id")
      .single();
    await admin.from("link_click_daily").insert([
      { link_id: link!.id, owner_id: aliceId, day: "2026-09-05", device: "ios", clicks: 7 },
      { link_id: link!.id, owner_id: aliceId, day: "2026-09-06", device: "android", clicks: 4 },
    ]);
    expect((await loadPostNumbers(numbersProject, {}, alice))!.clicks).toBe(11);

    // 開いている投稿は「前回」から外す（まだ送っていない投稿を開いたとき）
    expect((await loadPostNumbers(numbersProject, { postId: newer.postId }, alice))!.postId).toBe(older.postId);
    // 送った投稿を開いたときは、その投稿の数字
    expect(await loadPostNumbers(numbersProject, { postId: older.postId, sent: true }, alice)).toMatchObject({ kind: "this", postId: older.postId, views: 10, likes: 1 });
  });

  it("他人の投稿の数字は出さない", async () => {
    expect(await loadPostNumbers(numbersProject, {}, bob)).toBeNull();
    const { data } = await admin.from("posts").select("id").eq("project_id", numbersProject).limit(1);
    expect(await loadPostNumbers(numbersProject, { postId: data![0].id, sent: true }, bob)).toBeNull();
  });
});
