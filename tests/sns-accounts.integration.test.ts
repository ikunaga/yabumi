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

  it("データの削除を求められたら、アカウントごと消す", async () => {
    expect(await deleteAccountsByExternalId(admin, "threads", externalId)).toBe(1);
    expect((await admin.from("social_accounts").select("id").eq("id", accountId)).data).toEqual([]);
  });
});
