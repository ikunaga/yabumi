// SNS アカウントの保存・解除・削除（OAuth の受け口と Meta からの通知がやること）
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptToken } from "@/lib/crypto/token-cipher";
import { deleteAccountsByExternalId, revokeAccountsByExternalId, saveConnectedAccount } from "@/lib/sns/accounts";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
const externalId = `threads-${randomUUID()}`;

const account = () => ({
  ownerId: aliceId,
  sns: "threads" as const,
  externalId,
  displayName: "Alice",
  handle: "alice",
  accessToken: "long-lived-token",
  expiresAt: new Date("2026-12-02T00:00:00Z"),
  scopes: ["threads_basic"],
});

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("SNS アカウントの保存", () => {
  let accountId: string;

  it("アカウントと暗号化したトークンを保存する", async () => {
    accountId = await saveConnectedAccount(admin, account(), key);
    const { data } = await admin.from("social_account_tokens").select("*").eq("social_account_id", accountId).single();
    expect(data!.access_token_encrypted).not.toContain("long-lived-token");
    expect(decryptToken(data!.access_token_encrypted, accountId, key)).toBe("long-lived-token");
    expect(new Date(data!.expires_at!).toISOString()).toBe("2026-12-02T00:00:00.000Z");
  });

  it("本人はアカウントを読めるが、トークンは読めない。他人はどちらも読めない", async () => {
    expect((await alice.from("social_accounts").select("id, handle")).data).toEqual([{ id: accountId, handle: "alice" }]);
    expect((await alice.from("social_account_tokens").select("*")).data ?? []).toEqual([]);
    expect((await bob.from("social_accounts").select("id")).data).toEqual([]);
    expect((await bob.from("social_account_tokens").select("*")).data ?? []).toEqual([]);
  });

  it("つなぎ直すと行は増えず、トークンと状態が新しくなる", async () => {
    await admin.from("social_accounts").update({ status: "expired" }).eq("id", accountId);
    const again = await saveConnectedAccount(admin, { ...account(), accessToken: "new-token", handle: "alice2" }, key);
    expect(again).toBe(accountId);
    const { data } = await admin.from("social_accounts").select("status, handle").eq("id", accountId).single();
    expect(data).toEqual({ status: "active", handle: "alice2" });
    const { data: token } = await admin.from("social_account_tokens").select("access_token_encrypted").eq("social_account_id", accountId).single();
    expect(decryptToken(token!.access_token_encrypted, accountId, key)).toBe("new-token");
  });

  it("アプリが外されたら、アカウントは残してトークンを消す", async () => {
    expect(await revokeAccountsByExternalId(admin, "threads", externalId)).toBe(1);
    const { data } = await admin.from("social_accounts").select("status").eq("id", accountId).single();
    expect(data!.status).toBe("revoked");
    expect((await admin.from("social_account_tokens").select("*").eq("social_account_id", accountId)).data).toEqual([]);
  });

  it("データの削除を求められたら、アカウントごと消し、その SNS から受け取った数字と投稿の ID・URL も消す（本文は残す）", async () => {
    const { data: project } = await alice.from("projects").insert({ name: "削除の依頼" }).select("id").single();
    const { data: postId, error } = await alice.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: project!.id,
      p_body: "送った投稿",
      p_planned_at: null as unknown as string,
      p_status: "draft",
      p_targets: [{ sns: "threads", social_account_id: accountId }],
    });
    if (error) throw error;
    const { data: target } = await admin
      .from("post_targets")
      .update({ status: "published", published_at: new Date().toISOString(), external_post_id: "th-1", external_url: "https://www.threads.net/@alice/post/1" })
      .eq("post_id", postId!)
      .select("id")
      .single();
    await admin.from("post_metrics").insert({ post_target_id: target!.id, owner_id: aliceId, day_index: 1, values: { views: 10 } });
    await admin.from("account_metrics").insert({ social_account_id: accountId, owner_id: aliceId, day: "2026-10-11", values: { followers: 5 } });

    expect(await deleteAccountsByExternalId(admin, "threads", externalId)).toBe(1);
    expect((await admin.from("social_accounts").select("id").eq("id", accountId)).data).toEqual([]);
    expect((await admin.from("post_metrics").select("day_index").eq("post_target_id", target!.id)).data).toEqual([]);
    expect((await admin.from("account_metrics").select("day").eq("social_account_id", accountId)).data).toEqual([]);
    const { data: after } = await admin.from("post_targets").select("status, external_post_id, external_url, social_account_id").eq("id", target!.id).single();
    expect(after).toEqual({ status: "published", external_post_id: null, external_url: null, social_account_id: null });
    expect((await admin.from("posts").select("body").eq("id", postId!).single()).data?.body).toBe("送った投稿");
  });
});
