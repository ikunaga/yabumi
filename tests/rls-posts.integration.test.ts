// SNS アカウント・投稿まわりの RLS。他人のデータに触れないこと、トークンが画面側から読めないことを確かめる
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let aliceProject: string;
let bobProject: string;
let aliceAccount: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  aliceProject = (await alice.from("projects").insert({ name: "A" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "B" }).select("id").single()).data!.id;

  // アカウントの追加は OAuth の受け口（サーバー）が行う
  const admin = adminClient();
  const { data, error } = await admin
    .from("social_accounts")
    .insert({ owner_id: aliceId, sns: "x", external_id: "alice-x", display_name: "Alice" })
    .select("id")
    .single();
  if (error) throw error;
  aliceAccount = data.id;
  await admin.from("social_account_tokens").insert({ social_account_id: aliceAccount, access_token_encrypted: "secret" });
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("SNS アカウント", () => {
  it("本人は自分のアカウントを読める", async () => {
    const { data } = await alice.from("social_accounts").select("id");
    expect(data?.map((r) => r.id)).toEqual([aliceAccount]);
  });

  it("他人のアカウントは読めない", async () => {
    const { data } = await bob.from("social_accounts").select("id");
    expect(data).toEqual([]);
  });

  it("画面側からはアカウントを追加できない（OAuth を通さない追加を防ぐ）", async () => {
    const { error } = await alice.from("social_accounts").insert({ owner_id: aliceId, sns: "threads", external_id: "fake" });
    expect(error).not.toBeNull();
  });

  it("トークンは本人でも画面側から読めない", async () => {
    const { data } = await alice.from("social_account_tokens").select("*");
    expect(data ?? []).toEqual([]);
  });
});

describe("プロジェクトと SNS アカウントの紐づけ", () => {
  it("自分のプロジェクトと自分のアカウントはつなげる", async () => {
    const { error } = await alice.from("project_social_accounts").insert({ project_id: aliceProject, social_account_id: aliceAccount });
    expect(error).toBeNull();
  });

  it("他人のアカウントを自分のプロジェクトにつなげない", async () => {
    const { error } = await bob.from("project_social_accounts").insert({ project_id: bobProject, social_account_id: aliceAccount });
    expect(error).not.toBeNull();
  });
});

describe("投稿", () => {
  it("save_post で投稿と配信先をまとめて保存できる", async () => {
    const { data: postId, error } = await alice.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: aliceProject,
      p_body: "こんにちは",
      p_planned_at: null as unknown as string,
      p_status: "draft",
      p_targets: [{ sns: "x" }, { sns: "threads", body_override: "Threads 用" }],
    });
    expect(error).toBeNull();
    const { data: targets } = await alice.from("post_targets").select("sns, body_override").eq("post_id", postId!).order("sns");
    expect(targets).toEqual([
      { sns: "threads", body_override: "Threads 用" },
      { sns: "x", body_override: null },
    ]);

    // 送り先を減らすと、外した配信先は消える
    await alice.rpc("save_post", {
      p_post_id: postId!,
      p_project_id: aliceProject,
      p_body: "こんにちは",
      p_planned_at: null as unknown as string,
      p_status: "draft",
      p_targets: [{ sns: "x" }],
    });
    const { data: after } = await alice.from("post_targets").select("sns").eq("post_id", postId!);
    expect(after).toEqual([{ sns: "x" }]);
  });

  it("他人のプロジェクトには投稿を作れない", async () => {
    const { error } = await bob.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: aliceProject,
      p_body: "なりすまし",
      p_planned_at: null as unknown as string,
      p_status: "draft",
      p_targets: [],
    });
    expect(error).not.toBeNull();
  });

  it("他人の投稿は読めず、書き換えもできない", async () => {
    const { data: post } = await alice.from("posts").select("id").limit(1).single();
    const { data: read } = await bob.from("posts").select("id").eq("id", post!.id);
    expect(read).toEqual([]);
    const { error } = await bob.rpc("save_post", {
      p_post_id: post!.id,
      p_project_id: aliceProject,
      p_body: "乗っ取り",
      p_planned_at: null as unknown as string,
      p_status: "draft",
      p_targets: [],
    });
    expect(error).not.toBeNull();
    const { data: still } = await alice.from("posts").select("body").eq("id", post!.id).single();
    expect(still?.body).toBe("こんにちは");
  });

  it("他人のアカウントを送り先にできない", async () => {
    const { error } = await bob.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: bobProject,
      p_body: "x",
      p_planned_at: null as unknown as string,
      p_status: "draft",
      p_targets: [{ sns: "x", social_account_id: aliceAccount }],
    });
    expect(error).not.toBeNull();
    // 途中で失敗したら投稿自体も残らない
    const { data } = await bob.from("posts").select("id");
    expect(data).toEqual([]);
  });

  it("予約には日時が必要", async () => {
    const { error } = await alice.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: aliceProject,
      p_body: "x",
      p_planned_at: null as unknown as string,
      p_status: "scheduled",
      p_targets: [],
    });
    expect(error).not.toBeNull();
  });
});
