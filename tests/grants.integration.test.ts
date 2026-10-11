// テーブルと関数の権限（docs/architecture.md の 4.17）。RLS の前に、そもそも権限がないことを確かめる。
// 権限がないときは PostgREST が 42501（permission denied）を返す。RLS で弾かれたときは、空の結果か別のエラーになる
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const TABLES = [
  "projects",
  "social_accounts",
  "social_account_tokens",
  "project_social_accounts",
  "posts",
  "post_targets",
  "account_plans",
  "ai_threads",
  "ai_messages",
  "ai_usage",
  "github_installations",
  "project_github_repos",
  "project_manual_channels",
  "sns_api_usage",
  "media_files",
  "media_upload_tickets",
  "pending_page_choices",
] as const;

let alice: TestClient;
let aliceId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
});

afterAll(async () => {
  await deleteUser(aliceId);
});

describe("ログインしていない人（anon）", () => {
  it.each(TABLES)("%s を読めない（権限がない）", async (table) => {
    const { error } = await anonClient().from(table).select("*").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("投稿を保存する関数を呼べない", async () => {
    const { error } = await anonClient().rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: "00000000-0000-0000-0000-000000000000",
      p_body: "x",
      p_planned_at: null as unknown as string,
      p_status: "draft",
      p_targets: [],
    });
    expect(error?.code).toBe("42501");
  });
});

describe("ログインした利用者（authenticated）", () => {
  it("トークンの表は読めない（権限がない）", async () => {
    const { error } = await alice.from("social_account_tokens").select("*").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("費用の記録・会話は書けない（読むだけ）", async () => {
    expect((await alice.from("ai_usage").insert({ owner_id: aliceId, purpose: "x", model: "m", cost_usd: 0 })).error?.code).toBe("42501");
    expect((await alice.from("sns_api_usage").insert({ owner_id: aliceId, sns: "x", operation: "post", cost_usd: 0 })).error?.code).toBe("42501");
    expect((await alice.from("ai_messages").delete().eq("owner_id", aliceId)).error?.code).toBe("42501");
  });

  it("SNS のアカウントを自分で足せない（OAuth の受け口だけが足す）", async () => {
    const { error } = await alice.from("social_accounts").insert({ owner_id: aliceId, sns: "x", external_id: "e", display_name: "", handle: "" });
    expect(error?.code).toBe("42501");
  });

  it("配信先の送信の状態は書き換えられない（列ごとの権限）", async () => {
    const { error } = await alice.from("post_targets").update({ status: "published" }).eq("owner_id", aliceId);
    expect(error?.code).toBe("42501");
  });

  it("画像の記録は読むだけで書けない。引換券は読めない。画像の関数は呼べない（4.18）", async () => {
    const row = { owner_id: aliceId, storage_path: `${aliceId}/x.jpg`, width: 1, height: 1, size_bytes: 1 };
    expect((await alice.from("media_files").insert(row)).error?.code).toBe("42501");
    expect((await alice.from("media_files").update({ alt_text: "x" }).eq("owner_id", aliceId)).error?.code).toBe("42501");
    expect((await alice.from("media_upload_tickets").select("*").limit(1)).error?.code).toBe("42501");
    expect((await alice.rpc("media_usage_bytes", { p_owner_id: aliceId })).error?.code).toBe("42501");
    expect((await alice.rpc("cleanup_media_candidates", {})).error?.code).toBe("42501");
    const issue = await alice.rpc("issue_media_upload_ticket", {
      p_owner_id: aliceId,
      p_storage_path: `${aliceId}/y.jpg`,
      p_max_pending: 100,
      p_max_unattached: 100,
      p_quota_bytes: 1e9,
      p_max_file_bytes: 1,
    });
    expect(issue.error?.code).toBe("42501");
  });

  it("自分のプロジェクトは作って読める", async () => {
    const { data, error } = await alice.from("projects").insert({ name: "権限" }).select("id").single();
    expect(error).toBeNull();
    expect((await alice.from("projects").select("id").eq("id", data!.id)).data).toHaveLength(1);
  });
});
