// 退会のあとのログインと、費用のかかる呼び出し（セキュリティ確認 2026-11-13 の 2 回目の参考。src/lib/account/withdraw.ts）。
// 1. 退会すると、すべての端末のログインが切れる（ほかの端末はトークンを取り直せない）
// 2. 消えた利用者の id のままサーバーの権限で予約（reserve_*）を呼んでも、外部キーで断られ、外部の API（AI・画像・X）を呼ぶ前に止まる。費用の行も残らない
import { describe, expect, it } from "vitest";
import { withdrawUser } from "@/lib/account/withdraw";
import { adminClient, anonClient, deleteUser, signUpNewUser } from "./helpers/supabase";

const admin = adminClient();

// 同じ利用者の、もう 1 つの端末のログイン
async function secondDevice(userId: string) {
  const { data: u } = await admin.auth.admin.getUserById(userId);
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  if (error) throw error;
  const other = anonClient();
  const v = await other.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return other;
}

describe("退会すると、すべての端末のログインが切れる", () => {
  it("いまのログインのトークンで、利用者を消す前に global で切る（ほかの端末はトークンを取り直せない）", async () => {
    const { client, userId } = await signUpNewUser();
    const other = await secondDevice(userId);
    const { data: s } = await client.auth.getSession();
    // 退会の前は、ほかの端末も取り直せる
    expect((await other.auth.refreshSession()).error).toBeNull();

    await withdrawUser(admin, userId, { accessToken: s.session!.access_token });

    const after = await other.auth.refreshSession();
    expect(after.error).not.toBeNull();
    expect(after.data.session).toBeNull();
    expect((await admin.auth.admin.getUserById(userId)).data.user).toBeNull();
  });

  it("global の signOut だけでも、ほかの端末は取り直せなくなる（利用者を消す前に切れることを確かめる）", async () => {
    const { client, userId } = await signUpNewUser();
    const other = await secondDevice(userId);
    const { data: s } = await client.auth.getSession();
    expect((await admin.auth.admin.signOut(s.session!.access_token, "global")).error).toBeNull();
    expect((await other.auth.refreshSession()).error).not.toBeNull();
    await admin.auth.admin.deleteUser(userId);
  });
});

describe("消えた利用者の id のままでは、費用のかかる呼び出しの予約が通らない", () => {
  // 同じ引数で、いる利用者なら通る（引数の誤りで断られているのではないことを先に確かめる）
  const calls = (userId: string, projectId: string | null) => ({
    reserve_ai_usage: () => admin.rpc("reserve_ai_usage", { p_owner_id: userId, p_purpose: "post_ideas", p_cost_usd: 0.2, p_scope_owner: userId }),
    reserve_ai_images: () => admin.rpc("reserve_ai_images", { p_owner_id: userId, p_project_id: projectId as string, p_model: "gemini-2.5-flash-image", p_images: 1, p_cost_usd: 0.04, p_scope_owner: userId }),
    reserve_x_search: () => admin.rpc("reserve_x_search", { p_owner_id: userId, p_project_id: projectId as string, p_scope_owner: userId }),
  });

  it("AI・画像・X の検索の予約は、いる利用者なら通り、退会した利用者では断られる（外部の API を呼ぶ前に止まる）。費用の行も残らない", async () => {
    const live = await signUpNewUser();
    const liveProject = (await live.client.from("projects").insert({ name: "いる人" }).select("id").single()).data!.id;
    for (const [name, call] of Object.entries(calls(live.userId, liveProject))) {
      const { error } = await call();
      expect(error, name).toBeNull();
    }
    for (const t of ["ai_usage", "ai_image_jobs", "x_search_usage"] as const) await admin.from(t).delete().eq("owner_id", live.userId);
    await deleteUser(live.userId);

    const { client, userId } = await signUpNewUser();
    const projectId = (await client.from("projects").insert({ name: "退会のあと" }).select("id").single()).data!.id;
    await withdrawUser(admin, userId, {});
    const errors: Record<string, string | undefined> = {};
    for (const [name, call] of Object.entries(calls(userId, projectId))) errors[name] = (await call()).error?.message;
    // 利用者がいないこと・プロジェクト（利用者と一緒に消える）が本人のものでないことで断る
    expect(errors).toEqual({ reserve_ai_usage: "unknown user", reserve_ai_images: "unknown user", reserve_x_search: "invalid reservation" });
    // プロジェクトを渡さない X の検索でも、利用者がいなければ断る
    expect((await admin.rpc("reserve_x_search", { p_owner_id: userId, p_project_id: null as unknown as string, p_scope_owner: userId })).error).not.toBeNull();
    for (const t of ["ai_usage", "ai_image_jobs", "x_search_usage", "sns_api_usage"] as const) {
      const { count } = await admin.from(t).select("id", { count: "exact", head: true }).eq("owner_id", userId);
      expect(count, t).toBe(0);
    }
  });

  it("X の投稿・読み取りの予約は配信先に結びつく。配信先は利用者と一緒に消えるので、取り出せず予約もできない", async () => {
    const { client, userId } = await signUpNewUser();
    const projectId = (await client.from("projects").insert({ name: "送る前に退会" }).select("id").single()).data!.id;
    const { data: post } = await admin.from("posts").insert({ project_id: projectId, owner_id: userId, body: "x", status: "scheduled", planned_at: "2000-01-01T00:00:00Z" }).select("id").single();
    const { data: target } = await admin.from("post_targets").insert({ post_id: post!.id, owner_id: userId, sns: "x", status: "pending" }).select("id").single();
    await withdrawUser(admin, userId, {});
    // 送信ジョブが取り出す配信先はもうない
    expect((await admin.from("post_targets").select("id").eq("id", target!.id)).data).toEqual([]);
    const { error } = await admin.rpc("reserve_sns_spend", { p_owner_id: userId, p_sns: "x", p_post_target_id: target!.id, p_operation: "post", p_cost_usd: 0.01, p_budget_usd: 100, p_scope_owner: userId, p_user_budget_usd: 100 });
    expect(error?.code).toBe("23503");
    expect((await admin.from("sns_api_usage").select("id", { count: "exact", head: true }).eq("owner_id", userId)).count).toBe(0);
  });
});
