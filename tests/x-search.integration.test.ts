// X の人気の投稿を探す（4.52）: 予約の関数（月 3 回・新しい人は 1 回・全体 $1・新しい人たち全体は 3 分の 1・同時に押しても超えない・断った分を数えない）、
// 権限、退会・保存期間、呼び出しの失敗の扱い。X は偽の fetch で、本物の API は呼ばない。
// 全体の上限は p_scope_owner で、このテストの利用者の記録だけを数える（共有のローカル DB のほかの記録に左右されない）
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
// 画面から読む口（currentXSearchQuota）だけが使う。テストでは呼ばない
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { loadXSearchQuota, runXSearch } from "@/lib/sns/x/search-server";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const DAY = 86_400_000;

let alice: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let bobProject: string;
// 登録して 7 日を過ぎた時刻（同じ月の中で数えられるよう、行もこの時刻で作る）
let later: Date;

type Reserved = { usage_id: string | null; status: string; used: number; limit_count: number; resets_on: string | null };
const reserve = async (owner: string, project: string | null, asOf?: Date, scope = owner) => {
  const { data, error } = await admin.rpc("reserve_x_search", { p_owner_id: owner, p_project_id: project as string, p_scope_owner: scope, p_as_of: asOf?.toISOString() }).single();
  if (error) throw error;
  return data as Reserved;
};
const rows = async (owner: string) => (await admin.from("x_search_usage").select("status, cost_usd, post_count, user_count").eq("owner_id", owner).order("created_at")).data!;
const clear = (owner: string) => admin.from("x_search_usage").delete().eq("owner_id", owner);

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "季節の器", description: "器の店", target_audience: "30 代" }).select("id").single()).data!.id;
  bobProject = (await admin.from("projects").insert({ owner_id: bobId, name: "ほかの人", description: "" }).select("id").single()).data!.id;
  later = new Date(Date.now() + 8 * DAY);
});

afterAll(async () => {
  await clear(aliceId);
  await clear(bobId);
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("予約の関数", () => {
  it("登録して 7 日までは月 1 回。2 回目は断り、7 日たつ日（同じ月なら）を返す。断った分は数えない", async () => {
    const first = await reserve(aliceId, projectId);
    expect(first).toMatchObject({ status: "ok", used: 1, limit_count: 1 });
    expect(first.usage_id).toEqual(expect.any(String));
    const second = await reserve(aliceId, projectId);
    expect(second.usage_id).toBeNull();
    // 登録の 7 日後が来月なら、来月 1 日（来月の分）
    const { data: u } = await admin.auth.admin.getUserById(aliceId);
    const newUntil = new Date(new Date(u.user!.created_at).getTime() + 7 * DAY);
    const jst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
    const nextMonth = (() => {
      const t = jst(new Date());
      const [y, m] = [Number(t.slice(0, 4)), Number(t.slice(5, 7))];
      return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    })();
    if (jst(newUntil) < nextMonth) expect(second).toMatchObject({ status: "new_user_limit", resets_on: jst(newUntil) });
    else expect(second).toMatchObject({ status: "user_limit", resets_on: nextMonth });
    expect(await rows(aliceId)).toHaveLength(1);
    await clear(aliceId);
  });

  it("7 日を過ぎたら月 3 回。4 回目は断り、来月 1 日を返す", async () => {
    for (let i = 1; i <= 3; i++) expect(await reserve(aliceId, projectId, later)).toMatchObject({ status: "ok", used: i, limit_count: 3 });
    const fourth = await reserve(aliceId, projectId, later);
    expect(fourth).toMatchObject({ usage_id: null, status: "user_limit", used: 3, limit_count: 3 });
    expect(fourth.resets_on).toMatch(/^\d{4}-\d{2}-01$/);
    expect(await rows(aliceId)).toHaveLength(3);
    // 画面の残りの回数も同じ判定
    expect(await loadXSearchQuota(admin, aliceId, { scopeOwner: aliceId, asOf: later })).toEqual({ remaining: 0, limit: 3, reason: "user_limit", resetsOn: fourth.resets_on });
    await clear(aliceId);
  });

  it("同時に 6 回押しても、3 回までしか通らない", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => reserve(aliceId, projectId, later)));
    expect(results.filter((r) => r.usage_id).length).toBe(3);
    expect(await rows(aliceId)).toHaveLength(3);
    await clear(aliceId);
  });

  it("yabumi 全体の $1 を超える予約は断る（ほかの人の分も合わせて数える）", async () => {
    // ほかの人が今月 6 回分（$0.90）使った
    const at = later.toISOString();
    await admin.from("x_search_usage").insert(Array.from({ length: 6 }, () => ({ owner_id: bobId, cost_usd: 0.15, status: "done", created_at: at })));
    const r = await reserve(aliceId, projectId, later, bobId);
    expect(r).toMatchObject({ usage_id: null, status: "global_limit", used: 0, limit_count: 3 });
    expect(await rows(aliceId)).toHaveLength(0);
    expect(await loadXSearchQuota(admin, aliceId, { scopeOwner: bobId, asOf: later })).toMatchObject({ remaining: 3, reason: "global_limit" });
    // 実際の額が少なければ、その分だけ探せる（$0.90 → $0.80）
    const { data: two } = await admin.from("x_search_usage").select("id").eq("owner_id", bobId).limit(2);
    await admin.from("x_search_usage").update({ cost_usd: 0.1 }).in("id", two!.map((x) => x.id));
    expect((await reserve(aliceId, projectId, later, bobId)).status).toBe("ok");
    await clear(aliceId);
    await clear(bobId);
  });

  it("登録して 7 日までの人たち全体は、全体の 3 分の 1（$0.33）まで。印は予約のときにサーバーが付け、7 日たてば全体の枠で探せる", async () => {
    // 新しい人の予約には印が付く
    expect((await reserve(aliceId, projectId)).status).toBe("ok");
    expect((await admin.from("x_search_usage").select("by_new_user").eq("owner_id", aliceId)).data).toEqual([{ by_new_user: true }]);
    await clear(aliceId);
    // ほかの新しい人が今月 2 回分（$0.30）使った（印の付いた行で数える。いまのその人が新しいかどうかは見ない）
    await admin.from("x_search_usage").insert(Array.from({ length: 2 }, () => ({ owner_id: bobId, cost_usd: 0.15, status: "done", by_new_user: true })));
    const r = await reserve(aliceId, projectId, undefined, bobId);
    expect(r).toMatchObject({ usage_id: null, status: "new_global_limit", used: 0, limit_count: 1 });
    expect(r.resets_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await rows(aliceId)).toHaveLength(0);
    expect(await loadXSearchQuota(admin, aliceId, { scopeOwner: bobId })).toMatchObject({ remaining: 1, reason: "new_global_limit" });
    // 7 日を過ぎた人は全体の枠（$1）で数えるので探せる。その行には印が付かない
    const ok = await reserve(aliceId, projectId, later, bobId);
    expect(ok.status).toBe("ok");
    expect((await admin.from("x_search_usage").select("by_new_user").eq("owner_id", aliceId)).data).toEqual([{ by_new_user: false }]);
    await clear(aliceId);
    await clear(bobId);
  });

  it("他人のプロジェクトは付けられない（22023）", async () => {
    const { error } = await admin.rpc("reserve_x_search", { p_owner_id: aliceId, p_project_id: bobProject, p_scope_owner: aliceId });
    expect(error?.code).toBe("22023");
  });
});

describe("権限", () => {
  it("利用者は記録を読めず、予約・残りの回数の関数も直接は呼べない", async () => {
    await reserve(aliceId, projectId, later);
    const read = await alice.from("x_search_usage").select("id");
    expect(read.data ?? []).toEqual([]);
    expect((await alice.from("x_search_usage").insert({ owner_id: aliceId, cost_usd: 0 })).error).not.toBeNull();
    expect((await alice.rpc("reserve_x_search", { p_owner_id: aliceId, p_project_id: projectId })).error?.code).toBe("42501");
    expect((await alice.rpc("x_search_quota", { p_owner_id: aliceId })).error?.code).toBe("42501");
    await clear(aliceId);
  });
});

describe("呼び出しと失敗の扱い", () => {
  const scope = () => ({ userId: aliceId, projectId, word: "器 冬", scopeOwner: aliceId, asOf: later });
  const ok = {
    data: [
      { id: "11", text: "a", author_id: "1", created_at: "2026-11-05T00:00:00Z", public_metrics: { like_count: 5, retweet_count: 1, quote_count: 0, reply_count: 0 } },
      { id: "12", text: "b", author_id: "1", created_at: "2026-11-05T00:00:00Z", public_metrics: { like_count: 50, retweet_count: 0, quote_count: 0, reply_count: 0 } },
    ],
    includes: { users: [{ id: "1", name: "うつわ", username: "utsuwa" }] },
  };
  const fakeFetch = (impl: () => Promise<Response>) => vi.fn(impl) as unknown as typeof fetch;

  it("アプリの鍵で recent search を呼び、並べ直して返す。記録は実際の額（投稿 2 件・1 人 = $0.02）に直す。検索の言葉は残さない", async () => {
    const f = fakeFetch(async () => Response.json(ok));
    const r = await runXSearch(admin, { fetch: f, bearer: "test-bearer" }, scope());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.posts.map((p) => p.id)).toEqual(["12", "11"]);
    expect(r.quota).toMatchObject({ remaining: 2, limit: 3, reason: "ok" });
    const [url, init] = vi.mocked(f).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://api.x.com/2/tweets/search/recent?");
    expect(new URL(url).searchParams.get("query")).toBe("器 冬 lang:ja -is:retweet -is:reply");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-bearer");
    expect(await rows(aliceId)).toEqual([{ status: "done", cost_usd: 0.02, post_count: 2, user_count: 1 }]);
    await clear(aliceId);
  });

  it("4xx は請求されないので数えない（予約を消す）。言葉が合わない 400 は言葉を変えてもらう", async () => {
    const r = await runXSearch(admin, { fetch: fakeFetch(async () => new Response("{}", { status: 400 })), bearer: "b" }, scope());
    expect(r).toMatchObject({ ok: false, message: "この言葉では探せませんでした。言葉を変えてお試しください。", quota: { remaining: 3 } });
    const r429 = await runXSearch(admin, { fetch: fakeFetch(async () => new Response("{}", { status: 429 })), bearer: "b" }, scope());
    expect(r429).toMatchObject({ ok: false, quota: { remaining: 3 } });
    expect(await rows(aliceId)).toEqual([]);
  });

  it("5xx・届かない・形の違う応答は、請求されたかわからないので予約の額（$0.15）のまま数える", async () => {
    await runXSearch(admin, { fetch: fakeFetch(async () => new Response("{}", { status: 503 })), bearer: "b" }, scope());
    await runXSearch(admin, { fetch: fakeFetch(async () => { throw new TypeError("fetch failed"); }), bearer: "b" }, scope());
    const r = await runXSearch(admin, { fetch: fakeFetch(async () => Response.json({ data: "broken" })), bearer: "b" }, scope());
    expect(r).toMatchObject({ ok: false, message: "X から読み込めませんでした。時間をおいてもう一度お試しください。", quota: { remaining: 0, reason: "user_limit" } });
    expect(await rows(aliceId)).toEqual(Array.from({ length: 3 }, () => ({ status: "failed", cost_usd: 0.15, post_count: null, user_count: null })));
    // 上限なら X を呼ばない
    const f = fakeFetch(async () => Response.json(ok));
    expect((await runXSearch(admin, { fetch: f, bearer: "b" }, scope())).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
    await clear(aliceId);
  });
});

describe("退会と保存期間", () => {
  it("退会しても記録は消えず、紐づけだけ外れる（全体の合計に残る）", async () => {
    const { userId } = await signUpNewUser();
    const { data: p } = await admin.from("projects").insert({ owner_id: userId, name: "退会する人", description: "" }).select("id").single();
    const r = await reserve(userId, p!.id);
    await deleteUser(userId);
    const { data } = await admin.from("x_search_usage").select("owner_id, project_id, cost_usd").eq("id", r.usage_id!);
    expect(data).toEqual([{ owner_id: null, project_id: null, cost_usd: 0.15 }]);
    await admin.from("x_search_usage").delete().eq("id", r.usage_id!);
  });

  it("13 か月を過ぎた記録は purge_expired_data で消える", async () => {
    const old = new Date(Date.now() - 400 * DAY).toISOString();
    const { data } = await admin.from("x_search_usage").insert([{ owner_id: aliceId, cost_usd: 0.15, created_at: old }, { owner_id: aliceId, cost_usd: 0.15, created_at: new Date().toISOString() }]).select("id");
    expect((await admin.rpc("purge_expired_data")).error).toBeNull();
    const { data: left } = await admin.from("x_search_usage").select("id").in("id", data!.map((d) => d.id));
    expect(left).toEqual([{ id: data![1].id }]);
    await clear(aliceId);
  });
});
