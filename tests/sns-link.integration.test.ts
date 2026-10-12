// 1 つのプロジェクトに SNS ごとに 1 つ（docs/architecture.md の 4.6）。別のアカウントでつなぎ直したときの付け替え
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { linkAccountToProject } from "@/lib/sns/link";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;

const xAccount = (handle: string) => ({
  ownerId: aliceId,
  sns: "x" as const,
  externalId: `x-${randomUUID()}`,
  displayName: handle,
  handle,
  accessToken: `token-${handle}`,
  refreshToken: `refresh-${handle}`,
  expiresAt: null,
  scopes: ["tweet.write"],
});

// X の取り消しは呼んだことだけを記録する（本物の X には送らない）
const revoked: string[] = [];
const deps = { key, revokeX: async (token: string) => void revoked.push(token) };

async function newProject(client: TestClient, name: string) {
  const { data, error } = await client.from("projects").insert({ name }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function postWith(projectId: string, accountId: string, status: "pending" | "failed" | "published" | "publishing") {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: `${status} の投稿`,
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: [{ sns: "x", social_account_id: accountId }],
  });
  if (error) throw error;
  const extra = status === "published" ? { external_post_id: `x-${randomUUID()}`, external_url: "https://x.com/a/status/1", published_at: new Date().toISOString() } : {};
  const { data: target } = await admin
    .from("post_targets")
    .update({ status, ...extra })
    .eq("post_id", postId!)
    .select("id")
    .single();
  return target!.id;
}

const accountOf = async (targetId: string) => (await admin.from("post_targets").select("social_account_id").eq("id", targetId).single()).data!.social_account_id;
const linkedX = async (projectId: string) =>
  ((await admin.from("project_social_accounts").select("social_account_id, social_accounts!inner(sns)").eq("project_id", projectId).eq("social_accounts.sns", "x")).data ?? []).map(
    (r) => r.social_account_id,
  );

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("別のアカウントでつなぎ直す", () => {
  it("1 つにまとまり、古いアカウントのトークンと数字が消え、予約と送れなかった配信先は新しいアカウントに移る", async () => {
    const projectId = await newProject(alice, "付け替え");
    const oldId = await saveConnectedAccount(admin, xAccount("old"), key);
    expect(await linkAccountToProject(admin, { ownerId: aliceId, projectId, accountId: oldId }, deps)).toEqual([]);

    const pending = await postWith(projectId, oldId, "pending");
    const failed = await postWith(projectId, oldId, "failed");
    const publishing = await postWith(projectId, oldId, "publishing");
    const published = await postWith(projectId, oldId, "published");
    await admin.from("post_metrics").insert({ post_target_id: published, owner_id: aliceId, day_index: 1, values: { views: 3 } });
    await admin.from("account_metrics").insert({ social_account_id: oldId, owner_id: aliceId, day: "2026-10-11", values: { followers: 5 } });

    const newId = await saveConnectedAccount(admin, xAccount("new"), key);
    const replaced = await linkAccountToProject(admin, { ownerId: aliceId, projectId, accountId: newId }, deps);

    expect(replaced).toEqual([{ name: "@old", removed: true, movedTargets: 2 }]);
    expect(await linkedX(projectId)).toEqual([newId]);
    // 古いアカウントは X の側でも取り消し、矢書からアカウントとトークンと数字を消す
    expect(revoked).toEqual(["refresh-old", "token-old"]);
    expect((await admin.from("social_accounts").select("id").eq("id", oldId)).data).toEqual([]);
    expect((await admin.from("social_account_tokens").select("social_account_id").eq("social_account_id", oldId)).data).toEqual([]);
    expect((await admin.from("account_metrics").select("day").eq("social_account_id", oldId)).data).toEqual([]);
    expect((await admin.from("post_metrics").select("day_index").eq("post_target_id", published)).data).toEqual([]);
    // 予約（pending）と送れなかったもの（failed）は新しいアカウントから送る。送っている途中のものは動かさない（古いアカウントが消えたので空になる）
    expect(await accountOf(pending)).toBe(newId);
    expect(await accountOf(failed)).toBe(newId);
    expect(await accountOf(publishing)).toBeNull();
    // 送った記録は残り、SNS 上の ID と URL は消える（「外す」と同じ）
    const { data: pub } = await admin.from("post_targets").select("status, external_url, social_account_id").eq("id", published).single();
    expect(pub).toEqual({ status: "published", external_url: null, social_account_id: null });
  });

  it("同じアカウントでつなぎ直したときは、何も外さない", async () => {
    const projectId = await newProject(alice, "同じアカウント");
    const acc = xAccount("same");
    const id = await saveConnectedAccount(admin, acc, key);
    await linkAccountToProject(admin, { ownerId: aliceId, projectId, accountId: id }, deps);
    const again = await saveConnectedAccount(admin, { ...acc, accessToken: "token-same-2" }, key);
    expect(again).toBe(id);
    expect(await linkAccountToProject(admin, { ownerId: aliceId, projectId, accountId: again }, deps)).toEqual([]);
    expect(await linkedX(projectId)).toEqual([id]);
  });

  it("古いアカウントをほかのプロジェクトで使っていれば、このプロジェクトから外すだけで、アカウントとトークンは残す", async () => {
    const p1 = await newProject(alice, "使い続ける 1");
    const p2 = await newProject(alice, "使い続ける 2");
    const oldId = await saveConnectedAccount(admin, xAccount("shared"), key);
    await linkAccountToProject(admin, { ownerId: aliceId, projectId: p1, accountId: oldId }, deps);
    await linkAccountToProject(admin, { ownerId: aliceId, projectId: p2, accountId: oldId }, deps);
    const otherPending = await postWith(p2, oldId, "pending");
    revoked.length = 0;

    const newId = await saveConnectedAccount(admin, xAccount("new2"), key);
    const replaced = await linkAccountToProject(admin, { ownerId: aliceId, projectId: p1, accountId: newId }, deps);

    expect(replaced).toEqual([{ name: "@shared", removed: false, movedTargets: 0 }]);
    expect(await linkedX(p1)).toEqual([newId]);
    expect(await linkedX(p2)).toEqual([oldId]);
    expect(revoked).toEqual([]);
    expect((await admin.from("social_account_tokens").select("social_account_id").eq("social_account_id", oldId)).data).toHaveLength(1);
    // ほかのプロジェクトの予約は動かさない
    expect(await accountOf(otherPending)).toBe(oldId);
  });

  it("他人のプロジェクトやアカウントには付けられない", async () => {
    const bobProject = await newProject(bob, "他人のプロジェクト");
    const aliceAcc = await saveConnectedAccount(admin, xAccount("alice-only"), key);
    await expect(linkAccountToProject(admin, { ownerId: aliceId, projectId: bobProject, accountId: aliceAcc }, deps)).rejects.toThrow();
    await expect(linkAccountToProject(admin, { ownerId: bobId, projectId: bobProject, accountId: aliceAcc }, deps)).rejects.toThrow();
    expect((await admin.from("project_social_accounts").select("social_account_id").eq("project_id", bobProject)).data).toEqual([]);
  });
});

describe("DB の側でも、プロジェクトに同じ SNS を 2 つ入れられない", () => {
  it("2 つ目の同じ SNS のつながりは、利用者の権限でも service_role でも入らない。別の SNS は入る", async () => {
    const projectId = await newProject(alice, "2 つ目");
    const a = await saveConnectedAccount(admin, xAccount("first"), key);
    const b = await saveConnectedAccount(admin, xAccount("second"), key);
    const t = await saveConnectedAccount(admin, { ...xAccount("threads"), sns: "threads" as const }, key);
    expect((await alice.from("project_social_accounts").insert({ project_id: projectId, social_account_id: a })).error).toBeNull();
    expect((await alice.from("project_social_accounts").insert({ project_id: projectId, social_account_id: b })).error?.code).toBe("23505");
    expect((await admin.from("project_social_accounts").insert({ project_id: projectId, social_account_id: b, owner_id: aliceId })).error?.code).toBe("23505");
    expect((await alice.from("project_social_accounts").insert({ project_id: projectId, social_account_id: t })).error).toBeNull();
  });

  it("付け替えの関数は、利用者からは呼べない", async () => {
    const { error } = await alice.rpc("switch_project_sns_account", { p_owner_id: aliceId, p_project_id: randomUUID(), p_account_id: randomUUID() });
    expect(error?.code).toBe("42501");
  });
});
