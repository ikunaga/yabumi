// 手で投稿する SNS（note・Substack）: 予約ジョブが拾わないこと、手で投稿したことの記録、プロフィールの登録の RLS
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dueManualPostIds, overduePostIds } from "@/lib/posts/overdue";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { publishDueTargets } from "@/lib/sns/publisher";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const key = randomBytes(32);
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let accountId: string;

async function savePost(targets: object[], plannedAt: string, status = "scheduled") {
  const { data, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: "本文",
    p_planned_at: plannedAt,
    p_status: status,
    p_targets: targets as never,
  });
  if (error) throw error;
  return data!;
}
const targetsOf = async (postId: string) =>
  (await admin.from("post_targets").select("id, sns, status, title, external_url").eq("post_id", postId).order("sns")).data!;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "A" }).select("id").single()).data!.id;
  accountId = await saveConnectedAccount(
    admin,
    { ownerId: aliceId, sns: "threads", externalId: `t-${randomUUID()}`, displayName: "", handle: "a", accessToken: "tok", expiresAt: new Date("2099-01-01"), scopes: [] },
    key,
  );
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("手で投稿する SNS", () => {
  it("note の配信先にタイトルを保存できる", async () => {
    const postId = await savePost([{ sns: "note", title: "3 か月の振り返り", body_override: "長文" }], "2099-01-01T00:00:00Z");
    expect(await targetsOf(postId)).toMatchObject([{ sns: "note", status: "pending", title: "3 か月の振り返り" }]);
  });

  it("予約ジョブは手で投稿する SNS を拾わない（同じ投稿の Threads だけを送る）", async () => {
    const postId = await savePost(
      [{ sns: "threads", social_account_id: accountId }, { sns: "note", title: "t" }, { sns: "substack", title: "t" }],
      "2099-01-01T00:00:00Z",
    );
    const adapter: SnsAdapter = { sns: "threads", publishText: vi.fn(async () => ({ externalPostId: "m1", url: null })), deletePost: vi.fn() };
    const outcomes = await publishDueTargets(admin, { adapters: { threads: adapter }, key }, { postId });
    expect(outcomes.map((o) => o.sns)).toEqual(["threads"]);
    const ts = await targetsOf(postId);
    expect(ts.find((t) => t.sns === "note")!.status).toBe("pending");
    expect(ts.find((t) => t.sns === "substack")!.status).toBe("pending");
  });

  it("時刻が来た手で投稿する予定は「手で投稿する番」に出し、「止まった予約」には数えない", async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 60 * 60_000).toISOString();
    const postId = await savePost([{ sns: "note", title: "t" }], past);
    expect(await dueManualPostIds(alice, projectId, now)).toContain(postId);
    expect(await overduePostIds(alice, projectId, now)).not.toContain(postId);
    expect(await dueManualPostIds(bob, projectId, now)).toEqual([]);
  });

  it("本人は「投稿した」を記録できる（URL は任意、https のみ）。二度は記録しない", async () => {
    const postId = await savePost([{ sns: "note", title: "t" }, { sns: "substack", title: "t" }], "2099-01-01T00:00:00Z");
    const [note, substack] = await targetsOf(postId);

    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: note.id, p_url: "http://note.com/x" })).error).not.toBeNull();
    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: note.id, p_url: "https://note.com/masa/n/abc" })).error).toBeNull();
    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: substack.id, p_url: "" })).error).toBeNull();
    const after = await targetsOf(postId);
    expect(after).toMatchObject([
      { sns: "note", status: "published", external_url: "https://note.com/masa/n/abc" },
      { sns: "substack", status: "published", external_url: null },
    ]);
    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: note.id, p_url: "" })).error).not.toBeNull();
  });

  it("自動で送る SNS や、他人の配信先は「投稿した」にできない", async () => {
    const postId = await savePost([{ sns: "threads", social_account_id: accountId }, { sns: "note", title: "t" }], "2099-01-01T00:00:00Z");
    const ts = await targetsOf(postId);
    const threads = ts.find((t) => t.sns === "threads")!;
    const note = ts.find((t) => t.sns === "note")!;
    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: threads.id, p_url: "" })).error).not.toBeNull();
    expect((await bob.rpc("mark_manual_target_posted", { p_target_id: note.id, p_url: "" })).error).not.toBeNull();
    expect((await targetsOf(postId)).every((t) => t.status === "pending")).toBe(true);
  });
});

describe("手で投稿する SNS のプロフィール（project_manual_channels）", () => {
  it("本人は登録・変更・削除できる", async () => {
    expect((await alice.from("project_manual_channels").insert({ project_id: projectId, sns: "substack", profile_url: "https://masa.substack.com" })).error).toBeNull();
    expect((await alice.from("project_manual_channels").update({ profile_url: "https://news.example.com" }).eq("project_id", projectId).eq("sns", "substack")).error).toBeNull();
    expect((await alice.from("project_manual_channels").select("profile_url")).data).toEqual([{ profile_url: "https://news.example.com" }]);
  });

  it("他人は読めず、書き換えられず、他人のプロジェクトに登録もできない", async () => {
    expect((await bob.from("project_manual_channels").select("*")).data).toEqual([]);
    await bob.from("project_manual_channels").update({ profile_url: "https://evil.example.com" }).eq("project_id", projectId);
    await bob.from("project_manual_channels").delete().eq("project_id", projectId);
    expect((await alice.from("project_manual_channels").select("profile_url")).data).toEqual([{ profile_url: "https://news.example.com" }]);
    expect((await bob.from("project_manual_channels").insert({ project_id: projectId, sns: "note", owner_id: bobId })).error).not.toBeNull();
  });

  it("手で投稿する SNS 以外や、https でない URL は登録できない", async () => {
    expect((await alice.from("project_manual_channels").insert({ project_id: projectId, sns: "x" })).error).not.toBeNull();
    expect((await alice.from("project_manual_channels").insert({ project_id: projectId, sns: "note", profile_url: "javascript:alert(1)" })).error).not.toBeNull();
  });
});
