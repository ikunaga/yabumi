// 「TikTok は手で投稿する」（docs/design/tiktok.md の 17.。20261115090000_tiktok_by_hand）。
// 手で投稿するの文は TS（src/lib/sns/by-hand.ts）と SQL（public.by_hand_message）の 2 か所にあるので、close_attention の動きから一致を確かめる。
// テストの行はこのファイルの利用者だけに作る（共有のローカル DB）
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BY_HAND_MESSAGE, BY_HAND_SNS, NOT_BY_HAND_FILTER, isByHand } from "@/lib/sns/by-hand";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));
let current: TestClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));
const { markByHand, byHandTooLateMessage } = await import("@/lib/posts/by-hand");
const { dueManualPostIds } = await import("@/lib/posts/overdue");

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();

async function post(status: "draft" | "scheduled", targets: { sns: string; status: string; error_message?: string }[]) {
  const { data, error } = await admin.from("posts").insert({ project_id: projectId, owner_id: aliceId, body: `投稿 ${randomUUID()}`, status, planned_at: hoursAgo(1) }).select("id").single();
  if (error) throw error;
  const { data: ts, error: e2 } = await admin
    .from("post_targets")
    .insert(targets.map((t) => ({ post_id: data!.id, owner_id: aliceId, ...t })))
    .select("id");
  if (e2) throw e2;
  return { postId: data!.id, targetIds: ts!.map((t) => t.id) };
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "手で投稿" }).select("id").single()).data!.id;
  current = alice;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("手で投稿するの文（TS と SQL の一致）", () => {
  it("TS の文で作った X・TikTok の手で投稿するは、要確認の帯で閉じる対象に入らない（SQL の by_hand_message と同じ文）", async () => {
    for (const sns of BY_HAND_SNS) {
      const { targetIds: [t] } = await post("scheduled", [{ sns, status: "failed", error_message: BY_HAND_MESSAGE[sns] }]);
      const r = await alice.rpc("close_attention", { p_project_id: projectId, p_items: [{ kind: "failed", id: t }] as never });
      expect(r.error, sns).toBeNull();
      expect(r.data, sns).toBe(0);
    }
  });

  it("ほかの SNS の文・ふつうの失敗は閉じられる（文は SNS ごと）", async () => {
    const { targetIds: [a, b] } = await post("scheduled", [
      { sns: "tiktok", status: "failed", error_message: BY_HAND_MESSAGE.x },
      { sns: "x", status: "failed", error_message: "送れませんでした" },
    ]);
    const r = await alice.rpc("close_attention", { p_project_id: projectId, p_items: [{ kind: "failed", id: a }, { kind: "failed", id: b }] as never });
    expect(r.data).toBe(2);
  });

  it("by_hand_message は利用者の権限でもサーバーの権限でも直接は呼べない", async () => {
    expect((await alice.rpc("by_hand_message", { p_sns: "tiktok" })).error).not.toBeNull();
    expect((await admin.rpc("by_hand_message", { p_sns: "tiktok" })).error).not.toBeNull();
  });

  it("失敗の一覧から手で投稿するを除く条件（NOT_BY_HAND_FILTER）が、X・TikTok の両方を除く", async () => {
    const { postId } = await post("scheduled", [
      { sns: "x", status: "failed", error_message: BY_HAND_MESSAGE.x },
      { sns: "tiktok", status: "failed", error_message: BY_HAND_MESSAGE.tiktok },
      { sns: "threads", status: "failed", error_message: "送れませんでした" },
    ]);
    const { data, error } = await alice.from("post_targets").select("sns").eq("post_id", postId).eq("status", "failed").or(NOT_BY_HAND_FILTER);
    expect(error).toBeNull();
    expect(data!.map((t) => t.sns)).toEqual(["threads"]);
  });
});

describe("TikTok を手で投稿する印と記録", () => {
  it("送信待ちの TikTok に印を付けると、手で投稿するになり、手で投稿する番に出る", async () => {
    const { postId, targetIds: [t] } = await post("scheduled", [{ sns: "tiktok", status: "pending" }]);
    expect(await markByHand(admin, postId, aliceId, "tiktok")).toEqual({ ok: true });
    const row = (await admin.from("post_targets").select("sns, status, error_message").eq("id", t).single()).data!;
    expect(isByHand(row)).toBe(true);
    expect(await dueManualPostIds(alice, projectId, new Date(), 50)).toContain(postId);
  });

  it("送信ジョブがもう取り出していたら、書き換えずに知らせる", async () => {
    const { postId } = await post("scheduled", [{ sns: "tiktok", status: "preparing" }]);
    expect(await markByHand(admin, postId, aliceId, "tiktok")).toEqual({ ok: false, status: "preparing" });
    expect(byHandTooLateMessage("tiktok", "preparing")).toMatch(/TikTok には自動で送られます/);
  });

  it("手で投稿するの TikTok を、本人は「投稿した」と記録できる。ほかの人はできない", async () => {
    const { targetIds: [t] } = await post("scheduled", [{ sns: "tiktok", status: "failed", error_message: BY_HAND_MESSAGE.tiktok }]);
    expect((await bob.rpc("mark_manual_target_posted", { p_target_id: t, p_url: "" })).error?.code).toBe("P0002");
    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: t, p_url: "https://www.tiktok.com/@komugi/photo/1" })).error).toBeNull();
    const row = (await admin.from("post_targets").select("status, external_url, error_message").eq("id", t).single()).data!;
    expect(row).toEqual({ status: "published", external_url: "https://www.tiktok.com/@komugi/photo/1", error_message: null });
  });

  it("送信待ちの TikTok は、記録できない（自動で送るものと二重にしない）", async () => {
    const { targetIds: [t] } = await post("scheduled", [{ sns: "tiktok", status: "pending" }]);
    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: t, p_url: "" })).error?.code).toBe("P0002");
  });
});
