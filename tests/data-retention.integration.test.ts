// データの保存期間と削除（docs/architecture.md の 4.14）: 会話を消す、期限を過ぎたデータを消す、退会。
// SNS と GitHub には偽の関数を渡し、本物には送らない
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withdrawUser } from "@/lib/account/withdraw";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

async function newThread(ownerId: string, project: string, updatedAt?: string): Promise<string> {
  const { data, error } = await admin
    .from("ai_threads")
    .insert({ owner_id: ownerId, project_id: project, purpose: "account_plan", ...(updatedAt ? { updated_at: updatedAt } : {}) })
    .select("id")
    .single();
  if (error) throw error;
  await admin.from("ai_messages").insert({ thread_id: data.id, owner_id: ownerId, role: "user", content: { kind: "text", text: "こんにちは" } });
  return data.id;
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "A" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("会話を消す", () => {
  it("本人は自分の会話を消せる。中身もカスケードで消え、利用量の記録は紐づけだけが外れる", async () => {
    const threadId = await newThread(aliceId, projectId);
    const { data: usage } = await admin
      .from("ai_usage")
      .insert({ owner_id: aliceId, thread_id: threadId, purpose: "account_plan", model: "m", cost_usd: 0.01 })
      .select("id")
      .single();

    const { data, error } = await alice.from("ai_threads").delete().eq("id", threadId).select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((await admin.from("ai_messages").select("id").eq("thread_id", threadId)).data).toEqual([]);
    expect((await admin.from("ai_usage").select("thread_id").eq("id", usage!.id).single()).data).toEqual({ thread_id: null });
  });

  it("ほかの人の会話は消せない", async () => {
    const threadId = await newThread(aliceId, projectId);
    const { data } = await bob.from("ai_threads").delete().eq("id", threadId).select("id");
    expect(data).toEqual([]);
    expect((await admin.from("ai_threads").select("id").eq("id", threadId)).data).toHaveLength(1);
  });
});

describe("期限を過ぎたデータを消す", () => {
  it("最後のやり取りから 1 年たった会話と、13 か月たった費用の記録を消し、新しいものは残す", async () => {
    const day = 86400_000;
    const oldThread = await newThread(aliceId, projectId, new Date(Date.now() - 366 * day).toISOString());
    const recentThread = await newThread(aliceId, projectId, new Date(Date.now() - 300 * day).toISOString());
    const old = new Date(Date.now() - 400 * day).toISOString();
    const recent = new Date(Date.now() - 300 * day).toISOString();
    const { data: aiRows } = await admin
      .from("ai_usage")
      .insert([
        { owner_id: aliceId, purpose: "account_plan", model: "m", cost_usd: 0, created_at: old },
        { owner_id: aliceId, purpose: "account_plan", model: "m", cost_usd: 0, created_at: recent },
      ])
      .select("id");
    const { data: snsRows } = await admin
      .from("sns_api_usage")
      .insert([
        { owner_id: aliceId, sns: "x", operation: "post", cost_usd: 0, created_at: old },
        { owner_id: aliceId, sns: "x", operation: "post", cost_usd: 0, created_at: recent },
      ])
      .select("id");

    const { data, error } = await admin.rpc("purge_expired_data");
    expect(error).toBeNull();
    expect(data![0].ai_threads_deleted).toBeGreaterThanOrEqual(1);

    const threads = (await admin.from("ai_threads").select("id").in("id", [oldThread, recentThread])).data!.map((t) => t.id);
    expect(threads).toEqual([recentThread]);
    expect((await admin.from("ai_usage").select("id").in("id", aiRows!.map((r) => r.id))).data).toEqual([{ id: aiRows![1].id }]);
    expect((await admin.from("sns_api_usage").select("id").in("id", snsRows!.map((r) => r.id))).data).toEqual([{ id: snsRows![1].id }]);
  });

  it("ログインした利用者からは呼べない", async () => {
    expect((await alice.rpc("purge_expired_data")).error).not.toBeNull();
  });
});

describe("退会", () => {
  it("SNS と GitHub の連携を解除してから、本人のデータをすべて消す。費用の記録は匿名で残す", async () => {
    const { userId: carolId, client: carol } = await signUpNewUser();
    const carolProject = (await carol.from("projects").insert({ name: "C" }).select("id").single()).data!.id;
    await newThread(carolId, carolProject);
    const xAccount = await saveConnectedAccount(
      admin,
      {
        ownerId: carolId,
        sns: "x",
        externalId: `x-${carolId}`,
        displayName: "Carol",
        handle: "carol",
        accessToken: "carol-access",
        refreshToken: "carol-refresh",
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: ["tweet.write"],
      },
      key,
    );
    await saveConnectedAccount(
      admin,
      {
        ownerId: carolId,
        sns: "threads",
        externalId: `threads-${carolId}`,
        displayName: "Carol",
        handle: "carol",
        accessToken: "carol-threads",
        expiresAt: new Date(Date.now() + 86400_000),
        scopes: [],
      },
      key,
    );
    // 自分だけのインストールと、bob も使っているインストール
    const onlyCarol = 900_000_000 + Math.floor(Math.random() * 1_000_000);
    const shared = onlyCarol + 1;
    await admin.from("github_installations").insert([
      { owner_id: carolId, installation_id: onlyCarol, account_login: "carol" },
      { owner_id: carolId, installation_id: shared, account_login: "org" },
      { owner_id: bobId, installation_id: shared, account_login: "org" },
    ]);
    const { data: usage } = await admin
      .from("sns_api_usage")
      .insert({ owner_id: carolId, sns: "x", operation: "post", cost_usd: 0.015 })
      .select("id")
      .single();
    const { data: aiUsage } = await admin
      .from("ai_usage")
      .insert({ owner_id: carolId, purpose: "account_plan", model: "m", cost_usd: 0.5 })
      .select("id")
      .single();

    const revokeX = vi.fn(async () => {});
    const uninstallGithub = vi.fn(async () => {});
    const report = await withdrawUser(admin, carolId, { key, revokeX, uninstallGithub });

    expect(revokeX).toHaveBeenCalledWith("carol-refresh", "refresh_token");
    expect(revokeX).toHaveBeenCalledWith("carol-access", "access_token");
    expect(report.sns).toEqual(expect.arrayContaining([{ sns: "x", revoke: "revoked" }, { sns: "threads", revoke: "not_supported" }]));
    expect(uninstallGithub).toHaveBeenCalledTimes(1);
    expect(uninstallGithub).toHaveBeenCalledWith(onlyCarol);
    expect(report.github).toEqual(
      expect.arrayContaining([
        { installationId: onlyCarol, result: "uninstalled" },
        { installationId: shared, result: "shared" },
      ]),
    );

    // 本人のデータは消える
    expect((await admin.auth.admin.getUserById(carolId)).data.user).toBeNull();
    expect((await admin.from("projects").select("id").eq("owner_id", carolId)).data).toEqual([]);
    expect((await admin.from("ai_threads").select("id").eq("owner_id", carolId)).data).toEqual([]);
    expect((await admin.from("social_accounts").select("id").eq("owner_id", carolId)).data).toEqual([]);
    expect((await admin.from("social_account_tokens").select("social_account_id").eq("social_account_id", xAccount)).data).toEqual([]);
    expect((await admin.from("github_installations").select("installation_id").eq("owner_id", carolId)).data).toEqual([]);
    // bob のインストールは残る
    expect((await admin.from("github_installations").select("installation_id").eq("owner_id", bobId)).data).toEqual([{ installation_id: shared }]);
    // 費用の記録は紐づけを外して残る
    expect((await admin.from("sns_api_usage").select("owner_id").eq("id", usage!.id).single()).data).toEqual({ owner_id: null });
    expect((await admin.from("ai_usage").select("owner_id").eq("id", aiUsage!.id).single()).data).toEqual({ owner_id: null });
    // 匿名で残ることを確かめたら消す（残すと、共有のローカル DB で矢書全体の今月の合計が増え続ける）
    await admin.from("sns_api_usage").delete().eq("id", usage!.id);
    await admin.from("ai_usage").delete().eq("id", aiUsage!.id);
    await admin.from("sns_api_usage").delete().eq("id", usage!.id);
    await admin.from("ai_usage").delete().eq("id", aiUsage!.id);
  });

  it("SNS や GitHub の解除に失敗しても、退会は続ける", async () => {
    const { userId: daveId } = await signUpNewUser();
    await saveConnectedAccount(
      admin,
      {
        ownerId: daveId,
        sns: "x",
        externalId: `x-${daveId}`,
        displayName: "Dave",
        handle: "dave",
        accessToken: "a",
        refreshToken: "r",
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: [],
      },
      key,
    );
    await admin.from("github_installations").insert({ owner_id: daveId, installation_id: 800_000_000 + Math.floor(Math.random() * 1_000_000), account_login: "dave" });
    const report = await withdrawUser(admin, daveId, {
      key,
      revokeX: vi.fn(async () => {
        throw new Error("X が落ちている");
      }),
      uninstallGithub: vi.fn(async () => {
        throw new Error("GitHub が落ちている");
      }),
    });
    expect(report.sns).toEqual([{ sns: "x", revoke: "failed" }]);
    expect(report.github[0].result).toBe("failed");
    expect((await admin.auth.admin.getUserById(daveId)).data.user).toBeNull();
  });
});

// 退会した人の費用の記録は、だれからも読めない（紐づけが空なので RLS の本人に当たらない）
describe("匿名になった費用の記録", () => {
  it("ログインした利用者からは見えない", async () => {
    const { data } = await admin.from("sns_api_usage").insert({ owner_id: null, sns: "x", operation: "post", cost_usd: 0 }).select("id").single();
    expect((await alice.from("sns_api_usage").select("id").eq("id", data!.id)).data).toEqual([]);
    await admin.from("sns_api_usage").delete().eq("id", data!.id);
  });
});

