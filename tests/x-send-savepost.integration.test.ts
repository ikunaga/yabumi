// X の月の上限は、画面の判定が古くても、送る前に savePost が止める（PMO2 の x1）。額を消したあとは、同じ投稿を予約できる。
// X は偽の設定で「送れる SNS」にするだけで、X の API は呼ばない（予約は 10 分先で、確かめたらすぐ消す。送信ジョブには拾われない）
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
let current: TestClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));
vi.mock("@/lib/supabase/admin", async () => {
  const { adminClient } = await import("./helpers/supabase");
  // 同じ client を返す（checkXSend の RPC の回数を数えるため）
  let shared: ReturnType<typeof adminClient> | null = null;
  return { createAdminClient: () => (shared ??= adminClient()) };
});

const admin = adminClient();
let aliceId: string;
let projectId: string;

// 日本時間の "YYYY-MM-DDTHH:mm"
const jstInput = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16);

beforeAll(async () => {
  vi.stubEnv("X_CLIENT_ID", "test-dummy");
  vi.stubEnv("X_CLIENT_SECRET", "test-dummy");
  vi.stubEnv("APP_URL", process.env.APP_URL || "http://127.0.0.1:3100");
  ({ client: current, userId: aliceId } = await signUpNewUser());
  projectId = (await current.from("projects").insert({ name: "ねむり日和" }).select("id").single()).data!.id;
  const { saveConnectedAccount } = await import("@/lib/sns/accounts");
  const accountId = await saveConnectedAccount(
    admin,
    { ownerId: aliceId, sns: "x", externalId: `x-${randomUUID()}`, displayName: "", handle: "nemuri", accessToken: "tok", refreshToken: "r", expiresAt: new Date("2099-01-01"), scopes: ["media.write"] },
    randomBytes(32),
  );
  await admin.from("project_social_accounts").insert({ owner_id: aliceId, project_id: projectId, social_account_id: accountId });
});

afterAll(async () => {
  await admin.from("sns_api_usage").delete().eq("owner_id", aliceId);
  await deleteUser(aliceId);
  vi.unstubAllEnvs();
});

describe("savePost は X の月の上限で、送る前に止める", () => {
  it("今月の額で 1 人の上限に当たるなら、予約しない（投稿もつくらない）。額を消したら予約できる", async () => {
    const at = new Date(Date.now() + 10 * 60_000);
    // 10 分先が来月（日本時間）になる時刻なら、来月は上限が戻るので、この確かめは成り立たない
    if (jstInput(at).slice(0, 7) !== jstInput(new Date()).slice(0, 7)) return;
    const { savePost } = await import("@/lib/posts/actions");
    const input = {
      projectId,
      postId: null,
      body: "新しい版を出しました https://example.com/app",
      plannedAt: jstInput(at),
      intent: "schedule" as const,
      targets: [{ sns: "x" as const, bodyOverride: null, hashtags: [] }],
    };
    await admin.from("sns_api_usage").insert({ owner_id: aliceId, sns: "x", operation: "post", cost_usd: 0.95 });
    const blocked = await savePost(input);
    expect(blocked.fieldErrors?.targets).toContain("今月の X の自動投稿の上限（1 人 $1）");
    expect((await admin.from("posts").select("id").eq("project_id", projectId)).data).toEqual([]);

    // 画面を開いたあとに額が減った（消えた）ときは、そのまま予約できる
    await admin.from("sns_api_usage").delete().eq("owner_id", aliceId);
    await expect(savePost(input)).rejects.toThrow(/^REDIRECT \/projects\/.+\/calendar/);
    const posts = (await admin.from("posts").select("id, status").eq("project_id", projectId)).data!;
    expect(posts).toHaveLength(1);
    expect(posts[0].status).toBe("scheduled");
    // 送信ジョブに拾われないよう、すぐ消す
    await admin.from("posts").delete().eq("id", posts[0].id);
  });
});

describe("今すぐ送るも、X の月の上限でサーバーが止める（PMO2 の 3 回目の 02b。画面の確かめが出たまま押しても）", () => {
  it("今月の額で 1 人の上限に当たるなら、今すぐ送らない（投稿もつくらず、X の API も呼ばない）", async () => {
    const { savePost } = await import("@/lib/posts/actions");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await admin.from("sns_api_usage").insert({ owner_id: aliceId, sns: "x", operation: "post", cost_usd: 0.95 });
    try {
      const blocked = await savePost({
        projectId,
        postId: null,
        body: "新しい版を出しました https://example.com/app",
        plannedAt: "",
        intent: "now" as const,
        targets: [{ sns: "x" as const, bodyOverride: null, hashtags: [] }],
      });
      expect(blocked.fieldErrors?.targets).toContain("今月の X の自動投稿の上限（1 人 $1）");
      expect(blocked.sendPostId).toBeUndefined();
      expect((await admin.from("posts").select("id").eq("project_id", projectId)).data).toEqual([]);
      expect(fetchSpy.mock.calls.filter(([u]) => String(u instanceof Request ? u.url : u).includes("x.com"))).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
      await admin.from("sns_api_usage").delete().eq("owner_id", aliceId);
    }
  });
});

describe("checkXSend は今月の額を読み直すのを利用者ごとに 1 分 20 回までにし、送るとき（savePost）は毎回見る（App-L2）", () => {
  it("20 回までは毎回読み直す（額が増えれば次の見込みに出る）。超えたら RPC を流さず最後の額。見込みが古くても savePost は今の額で止める", async () => {
    const { checkXSend } = await import("@/lib/posts/x-send-actions");
    const { savePost } = await import("@/lib/posts/actions");
    const { clearXSpendCache, X_SPEND_LOADS_PER_WINDOW } = await import("@/lib/sns/x/spend-cache");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    clearXSpendCache();
    const rpc = vi.spyOn(createAdminClient(), "rpc");
    const text = "新しい版を出しました";
    const check = () => checkXSend({ projectId, text, altCount: 0, plannedAt: "" });
    try {
      expect((await check())?.now.over).toBeNull();
      expect(rpc.mock.calls.length).toBe(2);
      // 額が増えたら、次の見込み（押したときの調べ直し）に出る
      await admin.from("sns_api_usage").insert({ owner_id: aliceId, sns: "x", operation: "post", cost_usd: 0.995 });
      expect((await check())?.now.over).not.toBeNull();
      for (let i = 2; i < X_SPEND_LOADS_PER_WINDOW; i++) await check();
      expect(rpc.mock.calls.length).toBe(2 * X_SPEND_LOADS_PER_WINDOW);
      // 超えたら RPC を流さない（最後に読んだ額で答える）
      await admin.from("sns_api_usage").delete().eq("owner_id", aliceId);
      for (let i = 0; i < 10; i++) expect((await check())?.now.over).not.toBeNull();
      expect(rpc.mock.calls.length).toBe(2 * X_SPEND_LOADS_PER_WINDOW);
      // 見込みが古い額（上限に当たらない）のままでも、送るときは今の額で止める（投稿もつくらない）
      clearXSpendCache();
      for (let i = 0; i < X_SPEND_LOADS_PER_WINDOW; i++) expect((await check())?.now.over).toBeNull();
      await admin.from("sns_api_usage").insert({ owner_id: aliceId, sns: "x", operation: "post", cost_usd: 0.995 });
      expect((await check())?.now.over).toBeNull();
      const blocked = await savePost({ projectId, postId: null, body: text, plannedAt: "", intent: "now" as const, targets: [{ sns: "x" as const, bodyOverride: null, hashtags: [] }] });
      expect(blocked.fieldErrors?.targets).toContain("今月の X の自動投稿の上限（1 人 $1）");
      expect((await admin.from("posts").select("id").eq("project_id", projectId)).data).toEqual([]);
    } finally {
      rpc.mockRestore();
      clearXSpendCache();
      await admin.from("sns_api_usage").delete().eq("owner_id", aliceId);
    }
  });
});

describe("下書きの保存で、本文にあるタグを外し、選んでいたフォーマットを覚える（PMO2 の x2・s8）", () => {
  it("本文の #映画クイズ は、タグの行から外して保存する。フォーマットの id を覚え、他人のフォーマットは付けられない", async () => {
    const { savePost } = await import("@/lib/posts/actions");
    const { addFormat } = await import("@/lib/post-formats/store");
    const formatId = await addFormat(current, projectId, { name: "連想映画クイズ", body: "連想映画クイズ\n{キーワード}" });
    const draft = savePost({
      projectId,
      postId: null,
      body: "連想映画クイズ\n時計台・稲妻 #映画クイズ",
      plannedAt: "",
      intent: "draft",
      formatId,
      targets: [{ sns: "x" as const, bodyOverride: null, hashtags: ["#映画クイズ", "#個人開発"] }],
    });
    await expect(draft).rejects.toThrow(/^REDIRECT \/projects\/.+\/posts\/[0-9a-f-]+\?done=saved/);
    const post = (await admin.from("posts").select("id, format_id, post_targets(sns, hashtags)").eq("project_id", projectId).single()).data!;
    expect(post.format_id).toBe(formatId);
    expect(post.post_targets).toEqual([{ sns: "x", hashtags: ["個人開発"] }]);

    // 他人のフォーマットの id は、DB のトリガーで断る
    const { client: bob, userId: bobId } = await signUpNewUser();
    const bobProject = (await bob.from("projects").insert({ name: "ほかの人" }).select("id").single()).data!.id;
    const bobFormat = await addFormat(bob, bobProject, { name: "ほかの人の型", body: "{何か}" });
    expect((await current.from("posts").update({ format_id: bobFormat }).eq("id", post.id)).error?.code).toBe("23514");
    expect((await admin.from("posts").select("format_id").eq("id", post.id).single()).data!.format_id).toBe(formatId);
    // フォーマットを消したら、投稿は残り、覚えていた id は空になる
    await current.from("post_formats").delete().eq("id", formatId);
    expect((await admin.from("posts").select("format_id").eq("id", post.id).single()).data!.format_id).toBeNull();
    await admin.from("posts").delete().eq("id", post.id);
    await deleteUser(bobId);
  });
});

