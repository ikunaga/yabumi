// 投稿の本文を書いたのは誰か（posts.text_origin。docs/design/voice-from-posts.md の 2.3）: save_post で書く・前の呼び方のまま動く・
// 本人だけが直せる・自分で書いて送った投稿の本数
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countSelfWrittenPosts } from "@/lib/plan/voice";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const save = (client: TestClient, args: { postId?: string; body?: string; origin?: string }) =>
  client.rpc("save_post", {
    p_post_id: (args.postId ?? null) as string,
    p_project_id: projectId,
    p_body: args.body ?? "自分で書いた文",
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: [],
    ...(args.origin !== undefined ? { p_text_origin: args.origin } : {}),
  });
const originOf = async (id: string) => (await admin.from("posts").select("text_origin").eq("id", id).single()).data!.text_origin;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "こむぎ日和" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("save_post の text_origin", () => {
  it("前のコードの呼び方（p_text_origin なし）のまま動く。新しい投稿は self、前からある投稿の印は変えない", async () => {
    const { data: id, error } = await save(alice, {});
    expect(error).toBeNull();
    expect(await originOf(id as string)).toBe("self");
    await admin.from("posts").update({ text_origin: "ai" }).eq("id", id as string);
    expect((await save(alice, { postId: id as string, body: "直した" })).error).toBeNull();
    expect(await originOf(id as string)).toBe("ai");
  });

  it("渡せば書く（ai・self）。それ以外は断る（22023）", async () => {
    const { data: id } = await save(alice, { origin: "ai" });
    expect(await originOf(id as string)).toBe("ai");
    await save(alice, { postId: id as string, origin: "self" });
    expect(await originOf(id as string)).toBe("self");
    expect((await save(alice, { origin: "robot" })).error?.code).toBe("22023");
  });

  it("本人は直せる。ほかの人は直せない（関数でも、表でも）", async () => {
    const { data: id } = await save(alice, { origin: "ai" });
    expect((await alice.from("posts").update({ text_origin: "self" }).eq("id", id as string).select("id")).data).toHaveLength(1);
    expect(await originOf(id as string)).toBe("self");
    expect((await save(bob, { postId: id as string, origin: "ai" })).error).not.toBeNull();
    expect((await bob.from("posts").update({ text_origin: "ai" }).eq("id", id as string).select("id")).data).toEqual([]);
    expect(await originOf(id as string)).toBe("self");
  });
});

describe("自分で書いて送った投稿の本数", () => {
  it("送った配信先がある投稿のうち、AI の文でないもの（前からある null は自分で書いたもの）を数える", async () => {
    const p = (await alice.from("projects").insert({ name: "数える" }).select("id").single()).data!.id;
    const make = async (origin: string | null, published: boolean) => {
      const { data: post } = await admin.from("posts").insert({ project_id: p, owner_id: aliceId, body: "文", status: "scheduled", planned_at: new Date().toISOString(), text_origin: origin }).select("id").single();
      await admin.from("post_targets").insert([
        { post_id: post!.id, owner_id: aliceId, sns: "x", status: published ? "published" : "pending", published_at: published ? new Date().toISOString() : null },
        { post_id: post!.id, owner_id: aliceId, sns: "threads", status: published ? "published" : "pending", published_at: published ? new Date().toISOString() : null },
      ]);
    };
    await make("self", true);
    await make(null, true);
    await make("ai", true);
    await make("self", false);
    // 2 つの SNS に送っても 1 本と数える
    expect(await countSelfWrittenPosts(alice, p)).toBe(2);
    // ほかの人のプロジェクトは数えない（RLS）
    expect(await countSelfWrittenPosts(bob, p)).toBe(0);
  });
});
