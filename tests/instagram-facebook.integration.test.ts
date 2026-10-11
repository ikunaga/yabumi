// Instagram と Facebook ページ（docs/architecture.md の 4.21）: ページを選ぶまでの置き場、選んだページをつなぐ、
// Facebook 側で外された・削除を求められたとき、Instagram のトークンの延長。本物の Instagram・Facebook には送らない
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decryptToken } from "@/lib/crypto/token-cipher";
import { deleteAccountsByParentId, revokeAccountsByParentId, saveConnectedAccount } from "@/lib/sns/accounts";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import { choosePages, savePageChoice } from "@/lib/sns/facebook/pages";
import { refreshDueTokens } from "@/lib/sns/publisher";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const pages = (prefix: string) => [
  { id: `${prefix}1`, name: "アプリ A", accessToken: `${prefix}-token-1`, canPost: true },
  { id: `${prefix}2`, name: "アプリ B", accessToken: `${prefix}-token-2`, canPost: true },
  { id: `${prefix}3`, name: "見るだけ", accessToken: `${prefix}-token-3`, canPost: false },
];

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "A" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

const uniq = () => String(Date.now()) + String(Math.floor(Math.random() * 1000));

describe("Facebook ページを選ぶまでの置き場", () => {
  it("本人は一覧（ID と名前）を読めるが、トークンの列は読めない。ほかの人には見えない", async () => {
    const choiceId = await savePageChoice(admin, { ownerId: aliceId, projectId, parentExternalId: "fb-alice", pages: pages(uniq()) }, key);
    const { data, error } = await alice.from("pending_page_choices").select("id, pages").eq("id", choiceId).single();
    expect(error).toBeNull();
    // 投稿を作れないページは置かない
    expect((data!.pages as { name: string }[]).map((p) => p.name)).toEqual(["アプリ A", "アプリ B"]);

    expect((await alice.from("pending_page_choices").select("tokens_encrypted").eq("id", choiceId)).error?.code).toBe("42501");
    expect((await bob.from("pending_page_choices").select("id").eq("id", choiceId)).data).toEqual([]);
    expect((await alice.from("pending_page_choices").delete().eq("id", choiceId)).error?.code).toBe("42501");
  });

  it("選んだページだけをつなぎ、つないだ人の ID を持つ。トークンは暗号化して保存する。置き場は 1 回しか使えない", async () => {
    const p = uniq();
    const choiceId = await savePageChoice(admin, { ownerId: aliceId, projectId, parentExternalId: `fb-${p}`, pages: pages(p) }, key);
    const result = await choosePages(admin, { choiceId, ownerId: aliceId, pageIds: [`${p}2`, `${p}3`] }, key);
    expect(result?.projectId).toBe(projectId);
    // 投稿を作れないページ（3）は、選んでもつながらない
    expect(result?.accountIds).toHaveLength(1);

    const { data: acc } = await admin.from("social_accounts").select("*").eq("id", result!.accountIds[0]).single();
    expect(acc).toMatchObject({ sns: "facebook", external_id: `${p}2`, display_name: "アプリ B", parent_external_id: `fb-${p}`, status: "active" });
    const { data: tok } = await admin.from("social_account_tokens").select("*").eq("social_account_id", acc!.id).single();
    expect(tok!.expires_at).toBeNull();
    expect(decryptToken(tok!.access_token_encrypted, acc!.id, key)).toBe(`${p}-token-2`);

    expect(await choosePages(admin, { choiceId, ownerId: aliceId, pageIds: [`${p}1`] }, key)).toBeNull();
  });

  it("ほかの人の置き場や、期限（15 分）を過ぎた置き場は使えない", async () => {
    const choiceId = await savePageChoice(admin, { ownerId: aliceId, projectId, parentExternalId: "fb-x", pages: pages(uniq()) }, key);
    expect(await choosePages(admin, { choiceId, ownerId: bobId, pageIds: ["x"] }, key)).toBeNull();

    await admin.from("pending_page_choices").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", choiceId);
    expect(await choosePages(admin, { choiceId, ownerId: aliceId, pageIds: ["x"] }, key)).toBeNull();
    // 期限を過ぎたものは、毎日の削除で消える
    await admin.rpc("purge_expired_data");
    expect((await admin.from("pending_page_choices").select("id").eq("id", choiceId)).data).toEqual([]);
  });
});

describe("Facebook の側で外された・削除を求められた", () => {
  it("その Facebook の利用者がつないだページを、まとめて解除・削除する。ほかの人のページは残る", async () => {
    const parent = `fb-parent-${uniq()}`;
    const mk = (owner: string, page: string, parentId: string) =>
      saveConnectedAccount(
        admin,
        { ownerId: owner, sns: "facebook", externalId: page, displayName: page, handle: "", accessToken: "t", expiresAt: null, scopes: [], parentExternalId: parentId },
        key,
      );
    const a1 = await mk(aliceId, `page-${uniq()}`, parent);
    const a2 = await mk(aliceId, `page-${uniq()}`, parent);
    const other = await mk(bobId, `page-${uniq()}`, `fb-other-${uniq()}`);

    expect(await revokeAccountsByParentId(admin, "facebook", parent)).toBe(2);
    const { data: revoked } = await admin.from("social_accounts").select("id, status").in("id", [a1, a2, other]);
    expect(revoked!.find((r) => r.id === a1)?.status).toBe("revoked");
    expect(revoked!.find((r) => r.id === other)?.status).toBe("active");
    expect((await admin.from("social_account_tokens").select("social_account_id").in("social_account_id", [a1, a2])).data).toEqual([]);

    expect(await deleteAccountsByParentId(admin, "facebook", parent)).toBe(2);
    expect((await admin.from("social_accounts").select("id").in("id", [a1, a2])).data).toEqual([]);
    expect((await admin.from("social_accounts").select("id").eq("id", other)).data).toHaveLength(1);
  });
});

describe("Instagram のトークンの延長", () => {
  it("期限まで 30 日を切り、発行から 24 時間たった Instagram のトークンを日次のジョブで延長する。期限のない Facebook のページは対象外", async () => {
    const now = new Date();
    const ig = await saveConnectedAccount(
      admin,
      { ownerId: aliceId, sns: "instagram", externalId: `ig-${randomUUID()}`, displayName: "", handle: "alice", accessToken: "ig-1", expiresAt: new Date(now.getTime() + 10 * 86400_000), scopes: [] },
      key,
    );
    const fb = await saveConnectedAccount(
      admin,
      { ownerId: aliceId, sns: "facebook", externalId: `fb-${randomUUID()}`, displayName: "", handle: "", accessToken: "fb-1", expiresAt: null, scopes: [] },
      key,
    );
    // 発行から 24 時間たったことにする（updated_at はトリガーで今になるので、入れ直す）
    const { data: row } = await admin.from("social_account_tokens").select("*").eq("social_account_id", ig).single();
    await admin.from("social_account_tokens").delete().eq("social_account_id", ig);
    await admin.from("social_account_tokens").insert({ ...row!, updated_at: new Date(now.getTime() - 2 * 86400_000).toISOString() });

    const newExpiry = new Date(now.getTime() + 60 * 86400_000);
    const instagram: SnsAdapter = {
      sns: "instagram",
      publishText: vi.fn(),
      deletePost: vi.fn(),
      refreshToken: vi.fn(async () => ({ accessToken: "ig-2", expiresAt: newExpiry })),
      shouldRefresh: (expiresAt, at) => expiresAt.getTime() - at.getTime() < 30 * 86400_000,
    };
    // 共有のローカル DB で、ほかの人のアカウントを偽物で延長しないよう、alice のアカウントだけを対象にする
    const outcomes = await refreshDueTokens(admin, { adapters: { instagram }, key, now: () => now, onlyOwner: aliceId });
    expect(outcomes.find((o) => o.socialAccountId === ig)?.result).toBe("refreshed");
    expect(outcomes.find((o) => o.socialAccountId === fb)).toBeUndefined();
    const { data } = await admin.from("social_account_tokens").select("*").eq("social_account_id", ig).single();
    expect(decryptToken(data!.access_token_encrypted, ig, key)).toBe("ig-2");
  });
});
