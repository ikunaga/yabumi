// プロジェクトの「いつものタグ」（20261117100000_project_default_hashtags。2026-11-17 オーナーの依頼、案 A）:
// 本人だけが読み書きできる・DB の check（数・記号・キー・形）・ネタ帳から作る下書きに作る時点で入る（本文にあるタグは足さない）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noteToDraft } from "@/lib/notes/store";
import { loadDefaultHashtags } from "@/lib/projects/default-hashtags";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "こむぎ日和", product_type: "shop" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("いつものタグ（projects.default_hashtags）", () => {
  it("新しいプロジェクトは空で、本人は保存して読める", async () => {
    expect(await loadDefaultHashtags(alice, projectId)).toEqual({});
    const { error } = await alice.from("projects").update({ default_hashtags: { all: ["パン屋", "天然酵母"], x: ["パン"] } }).eq("id", projectId);
    expect(error).toBeNull();
    expect(await loadDefaultHashtags(alice, projectId)).toEqual({ all: ["パン屋", "天然酵母"], x: ["パン"] });
  });

  it("他人は読めず、書いても 0 行", async () => {
    const { data } = await bob.from("projects").select("default_hashtags").eq("id", projectId);
    expect(data).toEqual([]);
    expect(await loadDefaultHashtags(bob, projectId)).toEqual({});
    const { data: updated } = await bob.from("projects").update({ default_hashtags: { all: ["x"] } }).eq("id", projectId).select("id");
    expect(updated ?? []).toHaveLength(0);
    expect(await loadDefaultHashtags(alice, projectId)).toEqual({ all: ["パン屋", "天然酵母"], x: ["パン"] });
  });

  it("DB の check: 6 個以上・記号・空白・知らないキー・配列でない値・オブジェクトでない値は断る", async () => {
    const bad = [
      { all: ["a", "b", "c", "d", "e", "f"] },
      { x: ["#a"] },
      { x: ["a b"] },
      { x: ["a,b"] },
      { x: ["a".repeat(51)] },
      { mastodon: ["a"] },
      { x: "a" },
      { x: [1] },
      ["a"],
    ];
    for (const v of bad) {
      const { error } = await alice.from("projects").update({ default_hashtags: v as never }).eq("id", projectId);
      expect(error, JSON.stringify(v)).not.toBeNull();
    }
  });

  it("ネタ帳から作る下書きに、作る時点で入る（本文にあるタグは足さない）", async () => {
    await alice.from("projects").update({ default_hashtags: { all: ["パン屋", "天然酵母"] } }).eq("id", projectId);
    const noteId = (await alice.from("idea_notes").insert({ project_id: projectId, body: "朝の焼き上がり #天然酵母" }).select("id").single()).data!.id;
    const r = await noteToDraft(alice, admin, { userId: aliceId, projectId, noteId, accounts: { x: null as unknown as string } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { data: targets } = await alice.from("post_targets").select("sns, hashtags").eq("post_id", r.postId);
    expect(targets).toEqual([{ sns: "x", hashtags: ["パン屋"] }]);
  });
});
