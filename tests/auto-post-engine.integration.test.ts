// 自動の投稿のジョブ（docs/design/auto-post.md の 2.3・2.7。src/lib/auto-post/engine.ts、20261116120000_auto_post_engine）。
// 偽の AI・偽の AI っぽさチェック・偽の通知で、サーバーの権限で通す。回の取り出し・期限切れ・状態の見直し・知らせは、テストの利用者だけに絞る
// （共有のローカル DB のほかの人の行に触らない）。送信ジョブは投稿を指定して呼ぶ（ほかの人の予約は取り出さない）。最後にテストの行が 0 件になることを確かめる
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CallCheck } from "@/lib/ai/ai-check";
import { setAiBudgetTestScope } from "@/lib/ai/budget";
import type { AutoPostGenerator } from "@/lib/auto-post/ai";
import { addUpcomingRuns, draftRun, EXPIRED_MESSAGE, makeDueRuns, makeSample, notifyMade, remindApprovals, reviewPlans, runAutoPostJob, settleApprovals, tagReserve, type EngineDeps } from "@/lib/auto-post/engine";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import { publishDueTargets } from "@/lib/sns/publisher";
import { dueManualPostIds } from "@/lib/posts/overdue";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const key = randomBytes(32);
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let threadsAccount: string;
let xAccount: string;

const HOUR = 3_600_000;
const later = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const scopeOpts = () => ({ ownerIds: [aliceId] });

// 偽の AI: 材料の名前を入れた文。呼ぶたびに少しずつ違う文（重なりのチェックに引っかからないように）
let n = 0;
const generator: AutoPostGenerator = vi.fn(async (input) => {
  n++;
  return { ok: true as const, texts: Object.fromEntries(input.sns.map((s: string) => [s, `${input.materialLabel.replace(/^メモ: /, "")}の話 ${n} ${"いろはにほへとちりぬるを".slice(n % 5)}`])), pillar: "お店の日々", concern: "none" };
});
// 偽の AI っぽさチェック: findings を差し替えられる
let findings: { sns: string; kind: string; quote: string; why: string; fix: string }[] = [];
const callCheck: CallCheck = vi.fn(async () => ({ output: { summary: "よい", findings }, stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 } }));
const push = vi.fn(async () => ({ sent: 1, removed: 0, failed: 0 }));
const deps = (): EngineDeps => ({ generator, callCheck, push });

// 1 人 10 プロジェクトまでなので、テストごとに作ったプロジェクトは終わりに消す
const projects: string[] = [];
async function project(name = "パン屋") {
  const { data, error } = await alice.from("projects").insert({ name }).select("id").single();
  if (error) throw error;
  projects.push(data.id);
  await admin.from("project_social_accounts").insert([
    { project_id: data.id, social_account_id: threadsAccount, owner_id: aliceId },
    { project_id: data.id, social_account_id: xAccount, owner_id: aliceId },
  ]);
  return data.id as string;
}

async function plan(projectId: string, over: Record<string, unknown> = {}) {
  const { data, error } = await alice.rpc("save_auto_plan", {
    p_plan_id: null as unknown as string,
    p_project_id: projectId,
    p_name: "ネタ帳から",
    p_kind: "notes",
    p_materials: { note_order: "old_first" },
    p_targets: { threads: "auto", x: "review" },
    p_x_link: "never",
    p_schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], time: "09:00", every_weeks: 1, start: "2026-11-01" },
    p_instructions: [],
    p_lead_hours: 24,
    p_consent: true,
    ...over,
  });
  if (error) throw error;
  return data as string;
}

// 作る時刻が来た回を 1 つ置く（due は dueH 時間後）。1 人 1 日に SNS ごとに 2 本の上限に、テストどうしで届かないよう、
// 呼ぶたびに 1 日ずつ後ろにずらす（sameDay なら dueH 時間後のまま。上限そのものを試すとき）
let day = 0;
async function dueRun(planId: string, projectId: string, dueH = 20, sameDay = false) {
  const due = sameDay ? later(dueH) : later(dueH + 24 * day++);
  const { data, error } = await admin
    .from("auto_runs")
    .insert({ plan_id: planId, owner_id: aliceId, project_id: projectId, due_at: due, generate_at: new Date(Date.now() - 60_000).toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

const note = async (projectId: string, body: string) => (await alice.from("idea_notes").insert({ project_id: projectId, body }).select("id").single()).data!.id as string;
const runOf = async (id: string) => (await admin.from("auto_runs").select("status, reason, reason_detail, post_id, material_ref").eq("id", id).single()).data!;
const targetsOf = async (postId: string) => Object.fromEntries((await admin.from("post_targets").select("id, sns, status, error_message").eq("post_id", postId)).data!.map((t) => [t.sns, t]));

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  await admin.from("legal_consents").insert({ user_id: aliceId, version: "2026-11-16", via: "signup" });
  threadsAccount = await saveConnectedAccount(admin, { ownerId: aliceId, sns: "threads", externalId: `th-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: [] }, key);
  xAccount = await saveConnectedAccount(admin, { ownerId: aliceId, sns: "x", externalId: `x-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: [] }, key);
  // AI の枠は本人の分だけで数える（共有の DB のほかのテストに左右されない）
  setAiBudgetTestScope({ scopeSelf: true, asOf: new Date("2100-01-01T00:00:00Z") });
});

beforeEach(() => {
  findings = [];
  push.mockClear();
});

afterEach(async () => {
  await admin.from("projects").delete().in("id", projects.splice(0));
});

afterAll(async () => {
  setAiBudgetTestScope(null);
  await admin.from("ai_usage").delete().in("owner_id", [aliceId, bobId]);
  await deleteUser(aliceId);
  await deleteUser(bobId);
  for (const table of ["auto_plans", "auto_runs", "post_target_approvals", "ai_usage"] as const) {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("owner_id", [aliceId, bobId]);
    expect(count).toBe(0);
  }
});

describe("これからの回を足す", () => {
  it("動いている回し方の 14 日先までの回を、二重にせずに足す。止めた回し方の回は足さない", async () => {
    const p = await project();
    const id = await plan(p);
    const paused = await plan(p);
    await alice.rpc("set_auto_plan_status", { p_project_id: p, p_plan_id: paused, p_status: "paused" });
    await addUpcomingRuns(admin, new Date(), scopeOpts());
    const first = (await admin.from("auto_runs").select("id").eq("plan_id", id)).data!.length;
    expect(first).toBeGreaterThanOrEqual(13);
    expect(first).toBeLessThanOrEqual(15);
    await addUpcomingRuns(admin, new Date(), scopeOpts());
    expect((await admin.from("auto_runs").select("id").eq("plan_id", id)).data).toHaveLength(first);
    expect((await admin.from("auto_runs").select("id").eq("plan_id", paused)).data).toHaveLength(0);
    // 作る時刻は送る時刻の 24 時間前
    const r = (await admin.from("auto_runs").select("due_at, generate_at").eq("plan_id", id).limit(1).single()).data!;
    expect(new Date(r.due_at).getTime() - new Date(r.generate_at).getTime()).toBe(24 * HOUR);
    await admin.from("auto_runs").delete().in("plan_id", [id, paused]);
  });
});

describe("手動で投稿する SNS（note・Substack）", () => {
  it("つながずに by_hand で選べ、下書きの文を置く。送信ジョブは送らず、時刻が来たら「手動で投稿する番です」に出る", async () => {
    const p = await project();
    await note(p, "週末だけのあんバターを始めました");
    // note・Substack はつないでいない（project() がつなぐのは Threads・X だけ）
    const id = await plan(p, { p_targets: { threads: "auto", note: "by_hand", substack: "by_hand" } });
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    const run = await dueRun(id, p);
    expect(await makeDueRuns(admin, deps(), new Date(), scopeOpts())).toEqual({ scheduled: 1 });
    const r = await runOf(run);
    expect(r.status).toBe("scheduled");
    const ts = (await admin.from("post_targets").select("sns, status, social_account_id, error_message").eq("post_id", r.post_id!)).data!;
    const by = Object.fromEntries(ts.map((t) => [t.sns, t]));
    expect(Object.keys(by).sort()).toEqual(["note", "substack", "threads"]);
    for (const s of ["note", "substack"]) expect(by[s]).toMatchObject({ status: "pending", social_account_id: null, error_message: null });

    // 送信ジョブは Threads だけを送り、note・Substack は取り出さない
    const adapter: SnsAdapter = { sns: "threads", publishText: vi.fn(async () => ({ externalPostId: "m2", url: null })), deletePost: vi.fn() };
    const out = await publishDueTargets(admin, { adapters: { threads: adapter }, key, loadImages: async () => [] }, { postId: r.post_id! });
    expect(out.map((o) => o.sns)).toEqual(["threads"]);
    const after = Object.fromEntries((await admin.from("post_targets").select("sns, status").eq("post_id", r.post_id!)).data!.map((t) => [t.sns, t.status]));
    expect(after).toMatchObject({ note: "pending", substack: "pending" });

    // 送る時刻の前は出ず、来たら概要の「手動で投稿する番です」に出る
    const due = new Date((await admin.from("posts").select("planned_at").eq("id", r.post_id!).single()).data!.planned_at!);
    expect(await dueManualPostIds(admin, p, new Date(due.getTime() - 60_000))).not.toContain(r.post_id);
    expect(await dueManualPostIds(admin, p, new Date(due.getTime() + 60_000))).toContain(r.post_id);
  });

  it("送り先が note だけでも、つながりが切れた扱いにせず作る", async () => {
    const p = await project();
    await note(p, "note だけの回");
    const id = await plan(p, { p_targets: { note: "by_hand" } });
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    const run = await dueRun(id, p);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    const r = await runOf(run);
    expect(r.status).toBe("scheduled");
    expect((await admin.from("post_targets").select("sns, status").eq("post_id", r.post_id!)).data).toEqual([{ sns: "note", status: "pending" }]);
  });
});

describe("作る（偽の AI）", () => {
  it("2 回目からの回: 予約にし、Threads は送信待ち・X は確かめ待ち。メモを使ったことにする。送信ジョブは Threads だけを送る", async () => {
    const p = await project();
    const noteId = await note(p, "冬の新メニュー、かぼちゃのパンを始めました");
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    const run = await dueRun(id, p);
    const made = await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    expect(made).toEqual({ scheduled: 1 });
    const r = await runOf(run);
    expect(r.status).toBe("scheduled");
    expect(r.material_ref).toMatchObject({ note_id: noteId, pillar: "お店の日々" });
    const post = (await admin.from("posts").select("status, auto_run_id, text_origin, planned_at").eq("id", r.post_id!).single()).data!;
    expect(post).toMatchObject({ status: "scheduled", auto_run_id: run, text_origin: "ai" });
    const ts = await targetsOf(r.post_id!);
    expect(ts.threads.status).toBe("pending");
    expect(ts.x.status).toBe("awaiting_approval");
    expect((await admin.from("idea_notes").select("used_at, post_id").eq("id", noteId).single()).data!.post_id).toBe(r.post_id);
    // AI は自動の投稿の枠で数える（作る・チェック）
    const purposes = (await admin.from("ai_usage").select("purpose").eq("owner_id", aliceId)).data!.map((u) => u.purpose);
    expect(purposes).toContain("auto_post_check");

    // 送信ジョブ（投稿を指定。ほかの人の予約は取り出さない）: Threads だけを送り、X は確かめ待ちのまま
    const adapter: SnsAdapter = { sns: "threads", publishText: vi.fn(async () => ({ externalPostId: "m1", url: null })), deletePost: vi.fn() };
    const out = await publishDueTargets(admin, { adapters: { threads: adapter }, key, loadImages: async () => [] }, { postId: r.post_id! });
    expect(out.map((o) => [o.sns, o.result])).toEqual([["threads", "published"]]);
    expect((await targetsOf(r.post_id!)).x.status).toBe("awaiting_approval");
  });

  it("最初の回（A3）は下書きのまま確かめ待ち（review）", async () => {
    const p = await project();
    await note(p, "店の前の銀杏が色づきました");
    const id = await plan(p);
    const run = await dueRun(id, p);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    const r = await runOf(run);
    expect(r.status).toBe("review");
    expect((await admin.from("posts").select("status").eq("id", r.post_id!).single()).data!.status).toBe("draft");
  });

  it("事実か確かめての指摘は下書きに回す（held）。決まり文句は直して通す", async () => {
    const p = await project();
    await note(p, "メモ A");
    await note(p, "メモ B");
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    findings = [{ sns: "threads", kind: "made_up", quote: "の話", why: "本当ですか", fix: "" }];
    const held = await dueRun(id, p, 20);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    expect(await runOf(held)).toMatchObject({ status: "held", reason: "made_up" });
    expect((await admin.from("posts").select("status").eq("id", (await runOf(held)).post_id!).single()).data!.status).toBe("draft");

    findings = [{ sns: "threads", kind: "cliche", quote: "の話", why: "決まり文句", fix: "のこと" }];
    const fixed = await dueRun(id, p, 21);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    const r = await runOf(fixed);
    expect(r.status).toBe("scheduled");
    expect((await admin.from("posts").select("body").eq("id", r.post_id!).single()).data!.body).toContain("のこと");
  });

  it("材料がない・AI の枠を使い切った・SNS がつながっていない回は飛ばす", async () => {
    const p = await project();
    const id = await plan(p);
    const none = await dueRun(id, p, 20);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    expect(await runOf(none)).toMatchObject({ status: "skipped", reason: "no_material" });

    await note(p, "枠のテスト");
    const limited = await dueRun(id, p, 21);
    await makeDueRuns(admin, { ...deps(), generator: async () => ({ ok: false, reason: "ai_limit", detail: "今月の上限" }) }, new Date(), scopeOpts());
    expect(await runOf(limited)).toMatchObject({ status: "skipped", reason: "ai_limit" });

    const { data: lonely } = await alice.from("projects").insert({ name: "つないでいない" }).select("id").single();
    projects.push(lonely!.id);
    const id2 = await plan(lonely!.id);
    const cut = await dueRun(id2, lonely!.id);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    expect(await runOf(cut)).toMatchObject({ status: "skipped", reason: "disconnected" });
    // つながりが全部切れた回し方は止める
    await reviewPlans(admin, deps(), new Date(), scopeOpts());
    expect((await admin.from("auto_plans").select("status, stop_reason").eq("id", id2).single()).data).toEqual({ status: "stopped", stop_reason: "disconnected" });
    expect(push).toHaveBeenCalled();
  });

  it("書けなかった回（cannot_write）は選んだ材料を記録に残し、次の回は次の柱・次のメモへ進む", async () => {
    const p = await project();
    await admin.from("account_plans").upsert({ project_id: p, owner_id: aliceId, data: { pillars: { items: [{ name: "新作", share: null, example: "", sns: [] }, { name: "店の日常", share: null, example: "", sns: [] }], tone: "", avoid: "" } } as never });
    const cannot = (word: string): EngineDeps["generator"] => async (input) =>
      input.materialLabel.includes(word) ? { ok: false, reason: "cannot_write", detail: "材料が足りません" } : generator(input);

    const pid = await plan(p, { p_kind: "pillars", p_materials: {} });
    await admin.from("auto_plans").update({ first_review: false }).eq("id", pid);
    const first = await dueRun(pid, p, 20);
    await makeDueRuns(admin, { ...deps(), generator: cannot("新作") }, new Date(), scopeOpts());
    expect(await runOf(first)).toMatchObject({ status: "skipped", reason: "cannot_write", material_ref: { pillar: "新作" } });
    const second = await dueRun(pid, p, 21);
    await makeDueRuns(admin, { ...deps(), generator: cannot("新作") }, new Date(), scopeOpts());
    const r2 = await runOf(second);
    expect(r2.status).toBe("scheduled");
    expect((await admin.from("posts").select("body").eq("id", r2.post_id!).single()).data!.body).toContain("柱: 店の日常");

    const a = await note(p, "メモ A");
    const b = await note(p, "メモ B");
    const nid = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", nid);
    const n1 = await dueRun(nid, p, 22);
    await makeDueRuns(admin, { ...deps(), generator: cannot("メモ A") }, new Date(), scopeOpts());
    expect(await runOf(n1)).toMatchObject({ status: "skipped", reason: "cannot_write", material_ref: { note_id: a } });
    // 書けなかったメモは使ったことにしない（利用者は投稿をつくるで使える）
    expect((await admin.from("idea_notes").select("used_at").eq("id", a).single()).data!.used_at).toBeNull();
    const n2 = await dueRun(nid, p, 23);
    await makeDueRuns(admin, { ...deps(), generator: cannot("メモ A") }, new Date(), scopeOpts());
    expect(await runOf(n2)).toMatchObject({ status: "scheduled", material_ref: { note_id: b } });

    // AI の枠で飛ばした回は材料を残さない（同じ材料でやり直す）
    const c = await note(p, "メモ C");
    const n3 = await dueRun(nid, p, 24);
    await makeDueRuns(admin, { ...deps(), generator: async () => ({ ok: false, reason: "ai_limit", detail: "今月の上限" }) }, new Date(), scopeOpts());
    expect((await runOf(n3)).material_ref).toEqual({});
    const n4 = await dueRun(nid, p, 25);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    expect(await runOf(n4)).toMatchObject({ status: "scheduled", material_ref: { note_id: c } });
  });

  it("チェックに、利用者が書いた事実（プロジェクトの説明・届けたい相手・その回の材料）を渡す", async () => {
    const p = await project();
    await admin.from("projects").update({ description: "駅から歩いて 5 分のパン屋", target_audience: "近所の人" }).eq("id", p);
    await note(p, "くるみパンを焼き直した");
    const id = await plan(p);
    vi.mocked(callCheck).mockClear();
    await dueRun(id, p, 20);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    const req = vi.mocked(callCheck).mock.calls[0][0];
    const text = (req.messages[0].content as { text: string }[])[0].text;
    expect(text).toContain("<facts>");
    expect(text).toContain("<description>\n駅から歩いて 5 分のパン屋\n</description>");
    expect(text).toContain("<audience>\n近所の人\n</audience>");
    expect(text).toMatch(/<material>\n種類: ネタ帳のメモ[\s\S]*くるみパンを焼き直した\n<\/material>/);
  });

  it("止めた回し方の回は作らない。1 人 1 日に SNS ごとに 2 本まで", async () => {
    const p = await project();
    for (const b of ["メモ 1", "メモ 2", "メモ 3"]) await note(p, b);
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    // 同じ日（日本時間）の 3 回。日付をまたがないよう、明日の昼に寄せる
    const noon = new Date(`${new Date(Date.now() + 9 * HOUR + 86_400_000).toISOString().slice(0, 10)}T12:00:00+09:00`).getTime();
    const h = (noon - Date.now()) / HOUR;
    const runs = [await dueRun(id, p, h, true), await dueRun(id, p, h + 0.5, true), await dueRun(id, p, h + 1, true)];
    // claim_due_auto_runs（update ... returning）が返す順は決まっていない。逆の順で返ってきても、送る時刻の早い 2 回を作る（2026-11-21。時々落ちた原因）
    const reversed = new Proxy(admin, {
      get(t, k) {
        if (k === "rpc")
          return async (name: string, args: unknown) => {
            const r = await (t.rpc as unknown as (n: string, a: unknown) => Promise<{ data: unknown; error: unknown }>)(name, args);
            if (name === "claim_due_auto_runs" && Array.isArray(r.data)) r.data = [...r.data].sort((a, b) => Date.parse(b.due_at) - Date.parse(a.due_at));
            return r;
          };
        const v = Reflect.get(t, k);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    await makeDueRuns(reversed, deps(), new Date(), scopeOpts());
    const statuses = await Promise.all(runs.map(runOf));
    expect(statuses.map((s) => s.status)).toEqual(["scheduled", "scheduled", "skipped"]);
    expect(statuses[2].reason).toBe("daily_limit");
    const paused = await plan(p);
    await alice.rpc("set_auto_plan_status", { p_project_id: p, p_plan_id: paused, p_status: "paused" });
    const r = await dueRun(paused, p, 30);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    expect((await runOf(r)).status).toBe("waiting");
  });
});

describe("いつものタグ（2026-11-17）", () => {
  it("どの使い道の回にも、SNS ごとのいつものタグを付ける。本文にもあるタグは付けない。AI にはタグと、タグの行の分を引いた字数を渡す", async () => {
    const p = await project();
    await alice.from("projects").update({ default_hashtags: { all: ["パン屋"], x: ["パン", "天然酵母"] } }).eq("id", p);
    await note(p, "朝の焼き上がり");
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    const run = await dueRun(id, p);
    vi.mocked(generator).mockClear();
    vi.mocked(generator).mockImplementationOnce(async () => ({ ok: true as const, texts: { threads: "朝の焼き上がりの話 #パン屋", x: "朝の焼き上がりの話" }, pillar: "お店の日々", concern: "none" }));
    expect(await makeDueRuns(admin, deps(), new Date(), scopeOpts())).toEqual({ scheduled: 1 });
    const input = vi.mocked(generator).mock.calls[0][0];
    expect(input.fixedTags).toEqual({ threads: ["パン屋"], x: ["パン", "天然酵母"] });
    expect(input.maxLength.x).toBe(140 - tagReserve("x", ["パン", "天然酵母"]));
    expect(input.maxLength.threads).toBe(500 - tagReserve("threads", ["パン屋"]));
    const r = await runOf(run);
    const tags = Object.fromEntries((await admin.from("post_targets").select("sns, hashtags").eq("post_id", r.post_id!)).data!.map((t) => [t.sns, t.hashtags]));
    // Threads は本文に #パン屋 があるので、タグの行には付けない
    expect(tags).toEqual({ threads: [], x: ["パン", "天然酵母"] });
  });

  it("見本にもタグを返す", async () => {
    const p = await project();
    await alice.from("projects").update({ default_hashtags: { all: ["パン屋"] } }).eq("id", p);
    await note(p, "見本のメモ");
    const id = await plan(p);
    const { data: row } = await admin.from("auto_plans").select("*").eq("id", id).single();
    const { toPlan } = await import("@/lib/auto-post/plan-row");
    const r = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: toPlan(row!) });
    expect(r.ok && r.tags).toEqual({ threads: ["パン屋"], x: ["パン屋"] });
  });
});

describe("見本の 1 回（makeSample）", () => {
  it("次の回と同じ道で文を作り、チェックの結果を返す。投稿は作らず、メモも使ったことにしない", async () => {
    const p = await project();
    const noteId = await note(p, "見本のメモ");
    const id = await plan(p);
    const { data: row } = await admin.from("auto_plans").select("*").eq("id", id).single();
    const { toPlan } = await import("@/lib/auto-post/plan-row");
    const r = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: toPlan(row!) });
    expect(r.ok && Object.keys(r.texts).sort()).toEqual(["threads", "x"]);
    expect(r.ok && r.label).toBe("メモ: 見本のメモ");
    expect((await admin.from("idea_notes").select("used_at").eq("id", noteId).single()).data!.used_at).toBeNull();
    expect((await admin.from("posts").select("id").eq("project_id", p)).data).toEqual([]);
    findings = [{ sns: "x", kind: "made_up", quote: "の話", why: "本当ですか", fix: "" }];
    const held = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: toPlan(row!) });
    expect(held.ok && held.issues[0]?.kind).toBe("made_up");
  });
});

describe("シリーズの本文（フォーマットの文）は変えない（2026-11-20 本番の不具合）", () => {
  const FIXED = "この5つから連想される映画は？答えはコメントで！";
  const material = (text: string) => ({ text: "シリーズ", label: "シリーズ: テスト", ref: {}, allowedUrls: [], fixedTexts: { threads: text, x: text }, series: { formatId: randomUUID(), values: {} } });
  async function draft(text: string) {
    const p = await project();
    const id = await plan(p);
    const { data: row } = await admin.from("auto_plans").select("*").eq("id", id).single();
    const { toPlan } = await import("@/lib/auto-post/plan-row");
    return draftRun(admin, deps(), { plan: { ...toPlan(row!), ownerId: aliceId }, sns: ["threads", "x"], dueAt: new Date(Date.now() + 20 * HOUR), past: [], recent: { bySns: {}, mine: [] }, material: material(text) });
  }

  it("AI っぽさチェックの書き換えの案は当てず、数だけ記録する。止める指摘（事実か確かめて）は、いままでどおり止める", async () => {
    findings = [{ sns: "x", kind: "cliche", quote: "答えはコメントで！", why: "決まり文句", fix: "答えはリプで。" }];
    const r = await draft(FIXED);
    expect(r.ok && r.texts).toEqual({ threads: FIXED, x: FIXED });
    expect(r.ok && r.hold).toBeNull();
    expect(r.ok && r.ref.suggested).toBe(1);
    expect(r.ok && r.ref.fixed).toBeUndefined();
    findings = [{ sns: "x", kind: "made_up", quote: "映画", why: "本当ですか", fix: "" }];
    const held = await draft(FIXED);
    expect(held.ok && held.hold?.kind).toBe("made_up");
    expect(held.ok && held.texts.x).toBe(FIXED);
    findings = [];
  });

  it("字数の上限を超えるときは縮めず、下書きに回して理由を出す", async () => {
    const callShorten = vi.fn();
    const long = "あ".repeat(300);
    const p = await project();
    const id = await plan(p);
    const { data: row } = await admin.from("auto_plans").select("*").eq("id", id).single();
    const { toPlan } = await import("@/lib/auto-post/plan-row");
    const r = await draftRun(admin, { ...deps(), callShorten }, { plan: { ...toPlan(row!), ownerId: aliceId }, sns: ["threads", "x"], dueAt: new Date(Date.now() + 20 * HOUR), past: [], recent: { bySns: {}, mine: [] }, material: material(long) });
    expect(callShorten).not.toHaveBeenCalled();
    expect(r.ok && r.texts.x).toBe(long);
    expect(r.ok && r.hold).toMatchObject({ kind: "too_long", detail: expect.stringMatching(/^フォーマットの文が長すぎて .+ に送れません。下書きに残しました。下書きを編集して、文を短くしてください。$/) });
  });
});

describe("送る時刻を過ぎた確かめ待ち・送り直し", () => {
  it("確かめ待ちは失敗にして理由を入れる。送り直すと、いまの中身への承認の記録がなければ確かめ待ちに戻る。承認があれば送信待ち。他人は戻せない", async () => {
    const p = await project();
    await note(p, "期限切れのテスト");
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    const run = await dueRun(id, p, 20);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    const postId = (await runOf(run)).post_id!;
    await admin.from("posts").update({ planned_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", postId);
    expect(await settleApprovals(admin, new Date(), scopeOpts())).toBe(1);
    const ts = await targetsOf(postId);
    expect(ts.x).toMatchObject({ status: "failed", error_message: EXPIRED_MESSAGE });

    expect((await bob.rpc("requeue_failed_targets", { p_post_id: postId, p_sns: ["x"] })).error?.code).toBe("P0002");
    expect((await alice.rpc("requeue_failed_targets", { p_post_id: postId, p_sns: ["x"] })).data).toBe(1);
    expect((await targetsOf(postId)).x.status).toBe("awaiting_approval");

    // 承認の記録があれば（承認して送ったが X 側で失敗した、など）、送り直しは送信待ちに戻す
    await admin.from("post_targets").update({ status: "failed" }).eq("id", ts.x.id);
    // いまの中身と違う指紋の承認は数えない（承認のあとに中身が変わった）
    await admin.from("post_target_approvals").insert({ post_target_id: ts.x.id, owner_id: aliceId, fingerprint: "0".repeat(64) });
    await alice.rpc("requeue_failed_targets", { p_post_id: postId, p_sns: ["x"] });
    expect((await targetsOf(postId)).x.status).toBe("awaiting_approval");
    await admin.from("post_targets").update({ status: "failed" }).eq("id", ts.x.id);
    const { data: fp } = await admin.rpc("post_target_approval_fingerprint", { p_target_id: ts.x.id });
    await admin.from("post_target_approvals").update({ fingerprint: fp! }).eq("post_target_id", ts.x.id);
    await alice.rpc("requeue_failed_targets", { p_post_id: postId, p_sns: ["x"] });
    expect((await targetsOf(postId)).x.status).toBe("pending");
  });

  it("手で作った投稿の X は、承認がなくても今までどおり送信待ちに戻る", async () => {
    const p = await project();
    const { data: postId } = await alice.rpc("save_post", { p_post_id: null as unknown as string, p_project_id: p, p_body: "手で", p_planned_at: later(1), p_status: "scheduled", p_targets: [{ sns: "x", social_account_id: xAccount }] });
    await admin.from("post_targets").update({ status: "failed" }).eq("post_id", postId!);
    await alice.rpc("requeue_failed_targets", { p_post_id: postId!, p_sns: ["x"] });
    expect((await targetsOf(postId!)).x.status).toBe("pending");
  });

  it("最初の回: 利用者が投稿の画面で予約にしたら確かめ済みとして扱う。確かめないまま時刻を過ぎたら取り消す", async () => {
    const p = await project();
    await note(p, "最初の回 1");
    await note(p, "最初の回 2");
    const id = await plan(p);
    const a = await dueRun(id, p, 20);
    const b = await dueRun(id, p, 21);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    await admin.from("posts").update({ status: "scheduled" }).eq("id", (await runOf(a)).post_id!);
    await admin.from("auto_runs").update({ due_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", b);
    await settleApprovals(admin, new Date(), scopeOpts());
    expect((await runOf(a)).status).toBe("scheduled");
    expect((await admin.from("auto_plans").select("first_review").eq("id", id).single()).data!.first_review).toBe(false);
    expect(await runOf(b)).toMatchObject({ status: "canceled", reason: "user_skipped" });
  });
});

describe("状態の見直しと知らせ", () => {
  it("下書きに回した回を、送らないまま送る時刻を 2 回続けて過ぎたら止め、まだ送っていない予約を下書きに戻し、知らせる", async () => {
    const p = await project();
    for (const b of ["held 1", "held 2", "next"]) await note(p, b);
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    findings = [{ sns: "threads", kind: "made_up", quote: "の話", why: "本当ですか", fix: "" }];
    await dueRun(id, p, 20, true);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    // 送る時刻の前は、下書きに回した回もまだ数えない（利用者が確認して送るかもしれない。2026-11-25 本番）
    await reviewPlans(admin, deps(), new Date(), scopeOpts());
    expect((await admin.from("auto_plans").select("status, fail_streak").eq("id", id).single()).data).toEqual({ status: "active", fail_streak: 0 });
    // 送らないまま時刻を過ぎたら、1 回目の失敗
    await reviewPlans(admin, deps(), new Date(Date.now() + 21 * HOUR), scopeOpts());
    expect((await admin.from("auto_plans").select("status, fail_streak").eq("id", id).single()).data).toEqual({ status: "active", fail_streak: 1 });
    await dueRun(id, p, 30, true);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    findings = [];
    const next = await dueRun(id, p, 40, true);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    // いちばん新しい回は予約できたが、送る前なので数えない。その前の 2 回が、送らないまま時刻を過ぎた下書き
    push.mockClear();
    await reviewPlans(admin, deps(), new Date(Date.now() + 31 * HOUR), scopeOpts());
    expect((await admin.from("auto_plans").select("status, stop_reason").eq("id", id).single()).data).toEqual({ status: "stopped", stop_reason: "fail_streak" });
    expect((await runOf(next)).status).toBe("canceled");
    expect((await admin.from("posts").select("status").eq("id", (await runOf(next)).post_id!).single()).data!.status).toBe("draft");
    expect(push).toHaveBeenCalledWith(expect.anything(), aliceId, expect.objectContaining({ title: "自動投稿を止めました" }));
  });

  it("下書きに回した回でも、利用者が確認して送っていれば失敗に数えない。時間切れ（reason error）も数えない（2026-11-25 本番で止まった）", async () => {
    const p = await project();
    for (const b of ["held a", "held b"]) await note(p, b);
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    findings = [{ sns: "threads", kind: "avoid", quote: "の話", why: "やらないことに近いかもしれません", fix: "" }];
    const a = await dueRun(id, p, 20, true);
    const b = await dueRun(id, p, 30, true);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    findings = [];
    // 2 回とも下書きに回ったが、利用者が確認して送った
    for (const r of [a, b]) await admin.from("post_targets").update({ status: "published", published_at: new Date().toISOString() }).eq("post_id", (await runOf(r)).post_id!);
    // 時間切れで飛ばした回も 1 つ
    const c = await dueRun(id, p, 32, true);
    await admin.from("auto_runs").update({ status: "skipped", reason: "error", reason_detail: "時間内に作り終えられませんでした。3 回試しました", generate_at: new Date().toISOString() }).eq("id", c);
    await reviewPlans(admin, deps(), new Date(Date.now() + 33 * HOUR), scopeOpts());
    expect((await admin.from("auto_plans").select("status, fail_streak").eq("id", id).single()).data).toEqual({ status: "active", fail_streak: 0 });
  });

  it("材料切れが 3 回続いたら止める", async () => {
    const p = await project();
    const id = await plan(p);
    for (const h of [20, 21, 22]) await dueRun(id, p, h);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    await reviewPlans(admin, deps(), new Date(), scopeOpts());
    expect((await admin.from("auto_plans").select("stop_reason").eq("id", id).single()).data!.stop_reason).toBe("materials_out");
  });

  it("作った回は 1 人 1 通にまとめて知らせ（本文は入れない）、2 回目は送らない。確かめ待ちは 2 時間前にもう一度", async () => {
    const p = await project();
    await note(p, "知らせのテスト。この本文は通知に出ない");
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    const run = await dueRun(id, p, 1.5, true);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    push.mockClear();
    expect(await notifyMade(admin, deps(), new Date(), scopeOpts())).toBe(1);
    const msg = (push.mock.calls[0] as unknown[])[2] as { title: string; body: string; url: string };
    expect(msg.body).toMatch(/に X・Threads に送ります（X は確認が要ります）$/);
    expect(msg.body).not.toContain("知らせのテスト");
    expect(msg.url).toBe(`/projects/${p}/auto`);
    expect(await notifyMade(admin, deps(), new Date(), scopeOpts())).toBe(0);
    expect(await remindApprovals(admin, deps(), new Date(), scopeOpts())).toBe(1);
    expect(await remindApprovals(admin, deps(), new Date(), scopeOpts())).toBe(0);
    expect((await runOf(run)).status).toBe("scheduled");
    // 通知の設定でオフにした人には送らない
    await admin.from("notification_prefs").upsert({ user_id: aliceId, auto_post_push: false });
    await admin.from("auto_runs").update({ notified_at: null }).eq("id", run);
    push.mockClear();
    await notifyMade(admin, deps(), new Date(), scopeOpts());
    expect(push).not.toHaveBeenCalled();
    // オフにしている人は、知らせたことにする（次のジョブで試し続けない）
    expect((await admin.from("auto_runs").select("notified_at").eq("id", run).single()).data!.notified_at).not.toBeNull();
    await admin.from("notification_prefs").delete().eq("user_id", aliceId);
  });

  it("届ける端末が 1 台もないときは知らせたことにせず、端末が登録されたら 1 回だけ届く。送る時刻を過ぎた回は、いまさら送らない（2026-11-23 本番）", async () => {
    const p = await project();
    await note(p, "端末のテスト");
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    const run = await dueRun(id, p, 1.5, true);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    const notifiedAt = async () => (await admin.from("auto_runs").select("notified_at").eq("id", run).single()).data!.notified_at;
    // 端末がない（sendPush は 0 台に届けて返る）
    const noDevice = vi.fn(async () => ({ sent: 0, removed: 0, failed: 0 }));
    expect(await notifyMade(admin, { ...deps(), push: noDevice }, new Date(), scopeOpts())).toBe(0);
    expect(noDevice).toHaveBeenCalledTimes(1);
    expect(await notifiedAt()).toBeNull();
    // 次のジョブでまた試す（まだ端末がない）
    await notifyMade(admin, { ...deps(), push: noDevice }, new Date(), scopeOpts());
    expect(noDevice).toHaveBeenCalledTimes(2);
    expect(await notifiedAt()).toBeNull();
    // 端末が登録されたら 1 回だけ届き、そのあとは送らない
    push.mockClear();
    expect(await notifyMade(admin, deps(), new Date(), scopeOpts())).toBe(1);
    expect(await notifyMade(admin, deps(), new Date(), scopeOpts())).toBe(0);
    expect(push).toHaveBeenCalledTimes(1);
    expect(await notifiedAt()).not.toBeNull();
    // 送る時刻を過ぎてから端末が登録されても、古い知らせは送らない（知らせたことにする）
    await admin.from("auto_runs").update({ notified_at: null }).eq("id", run);
    push.mockClear();
    expect(await notifyMade(admin, deps(), new Date(Date.now() + 3 * HOUR), scopeOpts())).toBe(0);
    expect(push).not.toHaveBeenCalled();
    expect(await notifiedAt()).not.toBeNull();
  });

  it("ジョブの 1 回（runAutoPostJob）は、絞った利用者の中で一通り動く", async () => {
    const s = await runAutoPostJob(admin, deps(), { ownerIds: [aliceId], limit: 5 });
    expect(s).toHaveProperty("added");
    expect(s).toHaveProperty("made");
  });
});
