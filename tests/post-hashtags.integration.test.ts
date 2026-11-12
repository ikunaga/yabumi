// 毎回付けるタグ（20261112130000_post_hashtags。docs/architecture.md の 4.59）:
// 送る文の組み立て（DB の post_target_text と TS の withHashtags が同じ結果）・送信ジョブが組み立てた文を送る・save_post がタグを保存し、
// 渡さない呼び出しでは変えず、送った配信先は変えない・DB の check・列の権限・他人のフォーマットと配信先は読めない。
// SNS には偽のアダプターを使う。他のデータに触れないよう、取り出しは必ず postId を指定し、日時は未来にする（publisher.integration.test.ts と同じ）
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import type { Json } from "@/lib/supabase/database.types";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { publishDueTargets, type PublisherDeps } from "@/lib/sns/publisher";
import { targetText, withHashtags } from "@/lib/sns/hashtags";
import { addFormat, getFormat, listFormats, updateFormat } from "@/lib/post-formats/store";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
const FUTURE = "2099-01-01T00:00:00Z";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let accountId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "ねむり日和", product_type: "app" }).select("id").single()).data!.id;
  accountId = await saveConnectedAccount(
    admin,
    {
      ownerId: aliceId,
      sns: "threads",
      externalId: `threads-${randomUUID()}`,
      displayName: "Alice",
      handle: "alice",
      accessToken: "token-1",
      expiresAt: new Date(FUTURE),
      scopes: ["threads_basic"],
    },
    key,
  );
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

async function save(postId: string | null, body: string, targets: Json[], status = "draft") {
  const { data, error } = await alice.rpc("save_post", {
    p_post_id: postId as string,
    p_project_id: projectId,
    p_body: body,
    p_planned_at: FUTURE,
    p_status: status,
    p_targets: targets,
  });
  if (error) throw error;
  return data!;
}

async function targetsOf(postId: string) {
  const { data } = await admin.from("post_targets").select("id, sns, status, body_override, hashtags").eq("post_id", postId).order("sns");
  return data!;
}

describe("送る文の組み立て（DB と TS が同じ）", () => {
  const cases: [string, string[]][] = [
    ["本文です", ["個人開発", "indiedev"]],
    ["本文です\n\n", ["個人開発"]],
    ["本文です \t\r\n　", ["個人開発"]],
    ["1 行目\n2 行目\n\n#本文のタグ", ["映画"]],
    ["本文です", []],
    ["本文です\n", []],
    ["", ["個人開発", "indiedev"]],
    ["  \n　", ["個人開発"]],
    ["▶︎ くわしくはプロフィールのリンクから", ["映画", "音楽", "Netflix", "邦画", "サントラ"]],
  ];
  it.each(cases)("%j ＋ %j", async (body, tags) => {
    const { data, error } = await admin.rpc("post_target_text", { p_text: body, p_hashtags: tags });
    expect(error).toBeNull();
    expect(data).toBe(withHashtags(body, tags));
  });

  it("post_target_text は利用者からは呼べない（送信ジョブだけ）", async () => {
    expect((await alice.rpc("post_target_text", { p_text: "a", p_hashtags: ["b"] })).error).not.toBeNull();
    expect((await anonClient().rpc("post_target_text", { p_text: "a", p_hashtags: ["b"] })).error).not.toBeNull();
  });
});

describe("投稿の SNS ごとのタグ", () => {
  it("save_post はタグを保存し、送信ジョブは本文（SNS ごとの文面）＋空行＋タグを送る。TS の組み立てと同じ", async () => {
    const postId = await save(
      null,
      "共通の本文\n",
      [{ sns: "threads", social_account_id: accountId, hashtags: ["個人開発", "indiedev"] }],
      "scheduled",
    );
    const [t] = await targetsOf(postId);
    expect(t.hashtags).toEqual(["個人開発", "indiedev"]);
    const adapter: SnsAdapter = { sns: "threads", publishText: vi.fn(async () => ({ externalPostId: `m-${randomUUID()}`, url: "https://www.threads.com/@alice/post/x" })), deletePost: vi.fn(async () => {}) };
    const deps: PublisherDeps = { adapters: { threads: adapter }, key };
    await publishDueTargets(admin, deps, { postId });
    expect(adapter.publishText).toHaveBeenCalledWith(expect.anything(), "共通の本文\n\n#個人開発 #indiedev", []);
    expect(targetText("共通の本文\n", t)).toBe("共通の本文\n\n#個人開発 #indiedev");
    expect((await targetsOf(postId))[0].status).toBe("published");
  });

  it("SNS ごとの文面があれば、その後ろにタグを足す", async () => {
    const postId = await save(null, "共通", [{ sns: "threads", social_account_id: accountId, body_override: "Threads 用", hashtags: ["映画"] }], "scheduled");
    const adapter: SnsAdapter = { sns: "threads", publishText: vi.fn(async () => ({ externalPostId: `m-${randomUUID()}`, url: "https://www.threads.com/@alice/post/y" })), deletePost: vi.fn(async () => {}) };
    await publishDueTargets(admin, { adapters: { threads: adapter }, key }, { postId });
    expect(adapter.publishText).toHaveBeenCalledWith(expect.anything(), "Threads 用\n\n#映画", []);
  });

  it("タグを渡さない呼び出し（ネタ・相談・ネタ帳から）は、いまのタグを変えない。空の配列を渡すと外す", async () => {
    const postId = await save(null, "下書き", [{ sns: "x", hashtags: ["個人開発"] }, { sns: "instagram", hashtags: ["映画", "音楽"] }]);
    await save(postId, "下書き 2", [{ sns: "x" }, { sns: "instagram", hashtags: [] }]);
    const rows = await targetsOf(postId);
    expect(rows.map((r) => [r.sns, r.hashtags])).toEqual([
      ["instagram", []],
      ["x", ["個人開発"]],
    ]);
    // 新しく足した SNS で渡さなければ空
    await save(postId, "下書き 3", [{ sns: "x" }, { sns: "threads" }]);
    expect((await targetsOf(postId)).find((r) => r.sns === "threads")?.hashtags).toEqual([]);
  });

  it("送った配信先のタグは、保存し直しても変えない（送り直さない）", async () => {
    const postId = await save(null, "送った", [{ sns: "x", hashtags: ["個人開発"] }, { sns: "threads", hashtags: ["個人開発"] }]);
    const sent = (await targetsOf(postId)).find((r) => r.sns === "threads")!;
    await admin.from("post_targets").update({ status: "published", external_post_id: "123", published_at: new Date().toISOString() }).eq("id", sent.id);
    await save(postId, "送った", [{ sns: "x", hashtags: ["ちがうタグ"] }, { sns: "threads", hashtags: ["ちがうタグ"] }]);
    const rows = await targetsOf(postId);
    expect(rows.find((r) => r.sns === "threads")).toMatchObject({ status: "published", hashtags: ["個人開発"] });
    expect(rows.find((r) => r.sns === "x")?.hashtags).toEqual(["ちがうタグ"]);
  });

  it("DB の check: 6 個以上・空白・# ・カンマ（区切りと見分けがつかないもの）・空・51 字は入らない", async () => {
    const postId = await save(null, "check", [{ sns: "x" }]);
    const [t] = await targetsOf(postId);
    const set = (hashtags: string[]) => alice.from("post_targets").update({ hashtags }).eq("id", t.id);
    for (const bad of [["a", "b", "c", "d", "e", "f"], ["a b"], ["#a"], ["＃a"], ["a,b"], [""], ["a　b"], ["あ".repeat(51)]]) {
      expect((await set(bad)).error?.code, JSON.stringify(bad)).toBe("23514");
    }
    expect((await set(["a", "b", "c", "d", "あ".repeat(50)])).error).toBeNull();
    expect((await set([])).error).toBeNull();
  });

  it("他人は配信先のタグを読めず、書けない", async () => {
    const postId = await save(null, "秘密", [{ sns: "x", hashtags: ["ひみつ"] }]);
    const [t] = await targetsOf(postId);
    expect((await bob.from("post_targets").select("hashtags").eq("id", t.id)).data).toEqual([]);
    expect((await bob.from("post_targets").update({ hashtags: ["x"] }).eq("id", t.id).select("id")).data).toEqual([]);
    expect((await targetsOf(postId))[0].hashtags).toEqual(["ひみつ"]);
  });
});

describe("投稿のフォーマットのタグ", () => {
  let id: string;

  it("全部の SNS と SNS ごとのタグを保存して読める（# と区切りは整える）", async () => {
    id = await addFormat(alice, projectId, { name: "アプデ", body: "{版}を出しました", hashtags: { all: "#個人開発 indiedev、#個人開発", instagram: ["映画", "#音楽"] } });
    expect((await getFormat(alice, projectId, id))?.hashtags).toEqual({ all: ["個人開発", "indiedev"], instagram: ["映画", "音楽"] });
    await updateFormat(alice, projectId, id, { name: "アプデ", body: "{版}を出しました", hashtags: { x: "#buildinpublic" } });
    expect((await listFormats(alice, projectId))[0].hashtags).toEqual({ x: ["buildinpublic"] });
  });

  it("タグにできない言葉・6 個以上・知らないキーの扱い", async () => {
    await expect(addFormat(alice, projectId, { name: "x", body: "y", hashtags: { all: "a.b" } })).rejects.toThrow(/全部の SNS のタグ/);
    await expect(addFormat(alice, projectId, { name: "x", body: "y", hashtags: { threads: "a b c d e f" } })).rejects.toThrow(/5 個まで/);
    const other = await addFormat(alice, projectId, { name: "知らないキー", body: "y", hashtags: { mastodon: "a", all: "b" } });
    expect((await getFormat(alice, projectId, other))?.hashtags).toEqual({ all: ["b"] });
  });

  it("DB の check: 知らないキー・配列でない値・6 個以上・# 入り・51 字は入らない", async () => {
    const ins = (hashtags: unknown) => alice.from("post_formats").insert({ project_id: projectId, name: "x", body: "y", hashtags: hashtags as never });
    for (const bad of [[], "a", 1, { mastodon: ["a"] }, { all: "a" }, { all: [["a"]] }, { all: ["a,b"] }, { all: ["a", "b", "c", "d", "e", "f"] }, { x: ["#a"] }, { x: ["a b"] }, { x: [""] }, { x: [1] }, { x: ["あ".repeat(51)] }]) {
      expect((await ins(bad)).error?.code, JSON.stringify(bad)).toBe("23514");
    }
    // lax で書いていたときは、正しい値まで断っていた（配列の中身が 1 つずつ @ に入るため）
    for (const good of [{}, { all: ["a"] }, { instagram: ["a", "b", "c", "d", "あ".repeat(50)] }, { all: ["個人開発"], x: ["buildinpublic"], instagram: ["映画", "音楽"] }]) {
      expect((await ins(good)).error, JSON.stringify(good)).toBeNull();
    }
  });

  it("他人はフォーマットのタグを読めず、書けない", async () => {
    expect((await bob.from("post_formats").select("hashtags").eq("id", id)).data).toEqual([]);
    expect((await bob.from("post_formats").update({ hashtags: { all: ["x"] } }).eq("id", id).select("id")).data).toEqual([]);
    expect((await getFormat(alice, projectId, id))?.hashtags).toEqual({ x: ["buildinpublic"] });
  });
});
