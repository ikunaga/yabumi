// 確認できないまま送る時刻を過ぎた X を「今すぐ送る」（send_expired_auto_target。2026-11-28）と、過ぎたことの知らせ（プッシュ・メール）。
// 本物の SNS・プッシュ・メールには送らない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => ({ createAdminClient: (await import("./helpers/supabase")).adminClient }));
import { EXPIRED_MESSAGE, notifyExpired, settleApprovals, type EngineDeps } from "@/lib/auto-post/engine";
import { mailAutoNotices } from "@/lib/auto-post/mail";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const HOUR = 3_600_000;
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let planId: string;

const push = vi.fn(async () => ({ sent: 1, removed: 0, failed: 0 }));
const deps = (): EngineDeps => ({ generator: {} as never, callCheck: (async () => ({})) as never, push });
const scope = () => ({ ownerIds: [aliceId] });

// 送る時刻を過ぎた回（X は確認待ちのまま → settleApprovals で「確認できないまま過ぎた」にする）
async function expiredRun(hoursAgo = 1) {
  const due = new Date(Date.now() - hoursAgo * HOUR).toISOString();
  const { data: r, error } = await admin.from("auto_runs").insert({ plan_id: planId, owner_id: aliceId, project_id: projectId, due_at: due, generate_at: due, status: "scheduled" }).select("id").single();
  if (error) throw error;
  const { data: post, error: e2 } = await admin
    .from("posts")
    .insert({ project_id: projectId, owner_id: aliceId, body: "連想映画クイズ", status: "scheduled", planned_at: due, text_origin: "ai", auto_run_id: r.id, auto_created: true })
    .select("id")
    .single();
  if (e2) throw e2;
  await admin.from("auto_runs").update({ post_id: post.id }).eq("id", r.id);
  const { data: t, error: e3 } = await admin.from("post_targets").insert({ post_id: post.id, owner_id: aliceId, sns: "x", status: "awaiting_approval" }).select("id").single();
  if (e3) throw e3;
  await settleApprovals(admin, new Date(), scope());
  const fp = ((await alice.rpc("auto_target_previews", { p_post_id: post.id })).data ?? [])[0]!.fingerprint as string;
  return { runId: r.id, postId: post.id, targetId: t.id, fp, due };
}
const target = async (id: string) => (await admin.from("post_targets").select("status, error_message").eq("id", id).single()).data!;
const send = (c: TestClient, targetId: string, fp: string) => c.rpc("send_expired_auto_target", { p_target_id: targetId, p_fingerprint: fp });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  await admin.from("legal_consents").insert({ user_id: aliceId, version: "2026-11-16", via: "signup" });
  projectId = (await alice.from("projects").insert({ name: "映画のクイズ" }).select("id").single()).data!.id;
  const { data, error } = await alice.rpc("save_auto_plan", {
    p_plan_id: null as unknown as string,
    p_project_id: projectId,
    p_name: "連想映画クイズ",
    p_kind: "notes",
    p_materials: { note_order: "old_first" },
    p_targets: { threads: "auto", x: "review" },
    p_x_link: "never",
    p_schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], time: "21:00", every_weeks: 1, start: "2026-11-16" },
    p_instructions: [],
    p_lead_hours: 24,
    p_consent: true,
  });
  if (error) throw error;
  planId = data as string;
});

afterAll(async () => {
  await admin.from("notification_log").delete().eq("user_id", aliceId);
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("今すぐ送る（send_expired_auto_target）", () => {
  it("過ぎた印が付き、本人が見た中身のままなら、承認を記録して送る形に戻す。二度押しても 1 回だけ", async () => {
    const r = await expiredRun();
    expect(await target(r.targetId)).toEqual({ status: "failed", error_message: EXPIRED_MESSAGE });
    const [a, b] = await Promise.all([send(alice, r.targetId, r.fp), send(alice, r.targetId, r.fp)]);
    expect([a.error, b.error].filter(Boolean)).toHaveLength(1);
    expect([a.error, b.error].find(Boolean)!.code).toBe("P0002");
    expect(await target(r.targetId)).toEqual({ status: "pending", error_message: null });
    expect((await admin.from("post_target_approvals").select("fingerprint").eq("post_target_id", r.targetId)).data).toEqual([{ fingerprint: r.fp }]);
    // 送ったあとにもう一度押しても、送り直さない
    expect((await send(alice, r.targetId, r.fp)).error?.code).toBe("P0002");
  });

  it("2026-11-28 より前の文で過ぎた印が付いた行も、今すぐ送れる", async () => {
    const r = await expiredRun();
    await admin.from("post_targets").update({ error_message: "確認できないまま送る時刻を過ぎたので、送りませんでした。送るときは、日時を" + "直して確認してください。" }).eq("id", r.targetId);
    expect((await send(alice, r.targetId, r.fp)).error).toBeNull();
    expect((await target(r.targetId)).status).toBe("pending");
  });

  it("他人の配信先・匿名は断る", async () => {
    const r = await expiredRun();
    expect((await send(bob, r.targetId, r.fp)).error?.code).toBe("P0002");
    expect((await anonClient().rpc("send_expired_auto_target", { p_target_id: r.targetId, p_fingerprint: r.fp })).error?.code).toBe("42501");
    expect((await target(r.targetId)).status).toBe("failed");
  });

  it("過ぎてから 24 時間を過ぎたものは断る", async () => {
    const r = await expiredRun();
    await admin.from("posts").update({ planned_at: new Date(Date.now() - 25 * HOUR).toISOString() }).eq("id", r.postId);
    const res = await send(alice, r.targetId, r.fp);
    expect(res.error?.hint).toBe("expired_window_over");
    expect((await target(r.targetId)).status).toBe("failed");
  });

  it("見たあとに中身が変わっていたら断る", async () => {
    const r = await expiredRun();
    await admin.from("posts").update({ body: "連想映画クイズ（書き換えた）" }).eq("id", r.postId);
    const res = await send(alice, r.targetId, r.fp);
    expect(res.error?.hint).toBe("content_changed");
    expect((await target(r.targetId)).status).toBe("failed");
  });
});

describe("過ぎたことの知らせ", () => {
  it("プッシュは 1 回だけ（届かなければ次のジョブでまた）。リンクは確認の画面。夜中は鳴らさない。メールにも入る", async () => {
    await admin.from("posts").delete().eq("project_id", projectId);
    await admin.from("auto_runs").delete().eq("plan_id", planId);
    const r = await expiredRun(0.5);
    // 過ぎてから 24 時間のうちの、日本時間の昼と夜中
    const dueJst = new Date(new Date(r.due).getTime() + 9 * HOUR);
    let noon = new Date(Date.UTC(dueJst.getUTCFullYear(), dueJst.getUTCMonth(), dueJst.getUTCDate(), 12) - 9 * HOUR);
    if (noon.getTime() <= new Date(r.due).getTime()) noon = new Date(noon.getTime() + 24 * HOUR);
    let night = new Date(Date.UTC(dueJst.getUTCFullYear(), dueJst.getUTCMonth(), dueJst.getUTCDate(), 23) - 9 * HOUR);
    if (night.getTime() <= new Date(r.due).getTime()) night = new Date(night.getTime() + 24 * HOUR);

    push.mockClear();
    expect(await notifyExpired(admin, deps(), night, scope())).toBe(0);
    const noDevice = vi.fn(async () => ({ sent: 0, removed: 0, failed: 0 }));
    expect(await notifyExpired(admin, { ...deps(), push: noDevice }, noon, scope())).toBe(0);
    expect(noDevice).toHaveBeenCalledTimes(1);
    expect(await notifyExpired(admin, deps(), noon, scope())).toBe(1);
    expect(await notifyExpired(admin, deps(), noon, scope())).toBe(0);
    const msg = (push.mock.calls[0] as unknown[])[2] as { title: string; body: string; url: string };
    expect(msg.title).toBe("X への投稿を送っていません");
    expect(msg.url).toBe(`/projects/${projectId}/auto/review?run=${r.runId}`);

    const sent: { subject: string; text: string }[] = [];
    const fakeFetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    });
    await mailAutoNotices(admin, noon, { mail: { apiKey: "test-key", fetch: fakeFetch as unknown as typeof fetch }, appUrl: "https://yabumi.example" }, scope());
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("yabumi: 自動投稿の確認をお願いします");
    expect(sent[0].text).toMatch(/・「連想映画クイズ」.* の X の投稿は、送っていません。確認しないまま、送る時刻を過ぎました。.* までなら、今すぐ送れます。/);
    expect(sent[0].text).toContain(`  投稿を見て送る: https://yabumi.example/projects/${projectId}/auto/review?run=${r.runId}`);
    // 今すぐ送ったあとは、もう知らせない
    await send(alice, r.targetId, r.fp);
    await admin.from("notification_log").delete().eq("user_id", aliceId);
    expect(await notifyExpired(admin, deps(), noon, scope())).toBe(0);
  });
});
