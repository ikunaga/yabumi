// 送ったあと（pending 以外）の配信先の文面・タグなどを、利用者の権限から変えさせない（20261113100000_post_targets_lock_sent。
// セキュリティ確認 2026-11-13 の DB-L1）。サーバーの送る流れ・送った結果の記録・アカウントの付け替えと、アカウントを消したときの外部キーは止めない。
// タグの check がゼロ幅の文字と 2 次元の配列を弾く（参考 I1）。
// SNS には偽のアダプターを使う。他のデータに触れないよう、取り出しは必ず postId を指定し、日時は未来にする（publisher.integration.test.ts と同じ）
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import { publishDueTargets } from "@/lib/sns/publisher";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
const FUTURE = "2099-01-01T00:00:00Z";
const ZWSP = "​";

let alice: TestClient;
let aliceId: string;
let projectId: string;

async function account(): Promise<string> {
  return saveConnectedAccount(
    admin,
    { ownerId: aliceId, sns: "threads", externalId: `threads-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date(FUTURE), scopes: ["threads_basic"] },
    key,
  );
}

// 本人が予約した投稿（配信先は Threads 1 つ。pending）
async function scheduled(accountId: string | null): Promise<{ postId: string; targetId: string }> {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: "本文",
    p_planned_at: FUTURE,
    p_status: "scheduled",
    p_targets: [{ sns: "threads", social_account_id: accountId, title: "題", body_override: "Threads の文", hashtags: ["パン"] }],
  });
  if (error) throw error;
  const { data } = await admin.from("post_targets").select("id").eq("post_id", postId!).single();
  return { postId: postId!, targetId: data!.id };
}

async function row(targetId: string) {
  const { data } = await admin.from("post_targets").select("status, title, body_override, hashtags, social_account_id").eq("id", targetId).single();
  return data!;
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "送った配信先" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
});

describe("送ったあとの配信先は、利用者の権限から文面・タグを変えられない", () => {
  for (const status of ["published", "preparing", "failed", "publishing", "deleted"] as const) {
    it(`${status} の行は、タグ・文面・題・アカウントを変えられない（変わらない）`, async () => {
      const acc = await account();
      const { targetId } = await scheduled(acc);
      const set = await admin
        .from("post_targets")
        .update({ status, ...(status === "published" || status === "deleted" ? { published_at: new Date().toISOString() } : {}) })
        .eq("id", targetId);
      expect(set.error).toBeNull();
      for (const change of [{ hashtags: ["新作"] }, { body_override: "書き換え" }, { title: "書き換え" }, { social_account_id: null }]) {
        const { error } = await alice.from("post_targets").update(change).eq("id", targetId);
        expect(error?.code, JSON.stringify(change)).toBe("42501");
      }
      expect(await row(targetId)).toMatchObject({ status, title: "題", body_override: "Threads の文", hashtags: ["パン"], social_account_id: acc });
    });
  }

  it("pending の行は変えられる。同じ値の書き込み（変わらない列）は送ったあとでも通る", async () => {
    const { targetId } = await scheduled(await account());
    expect((await alice.from("post_targets").update({ hashtags: ["新作"], body_override: "直した", title: "直した題" }).eq("id", targetId)).error).toBeNull();
    expect(await row(targetId)).toMatchObject({ hashtags: ["新作"], body_override: "直した", title: "直した題" });
    await admin.from("post_targets").update({ status: "published", published_at: new Date().toISOString() }).eq("id", targetId);
    expect((await alice.from("post_targets").update({ hashtags: ["新作"] }).eq("id", targetId)).error).toBeNull();
  });

  it("save_post で保存し直しても、送った配信先は変えずにエラーにならない（ほかの SNS にも送る）", async () => {
    const acc = await account();
    const { postId, targetId } = await scheduled(acc);
    await admin.from("post_targets").update({ status: "published", published_at: new Date().toISOString() }).eq("id", targetId);
    const { error } = await alice.rpc("save_post", {
      p_post_id: postId,
      p_project_id: projectId,
      p_body: "本文",
      p_planned_at: FUTURE,
      p_status: "scheduled",
      p_targets: [{ sns: "threads", social_account_id: acc, title: "別", body_override: "別の文", hashtags: ["別"] }],
    });
    expect(error).toBeNull();
    expect(await row(targetId)).toMatchObject({ status: "published", title: "題", body_override: "Threads の文", hashtags: ["パン"] });
  });
});

describe("サーバーの処理は止めない", () => {
  it("送信ジョブで送れる（pending → publishing → published）", async () => {
    const { postId, targetId } = await scheduled(await account());
    const threads: SnsAdapter = { sns: "threads", publishText: vi.fn(async () => ({ externalPostId: `m-${randomUUID()}`, url: null })), deletePost: vi.fn(async () => {}) };
    const [o] = await publishDueTargets(admin, { adapters: { threads }, key }, { postId });
    expect(o.result).toBe("published");
    expect((await row(targetId)).status).toBe("published");
    expect(vi.mocked(threads.publishText).mock.calls[0][1]).toBe("Threads の文\n\n#パン");
  });

  it("サーバーの権限なら、送ったあとの行のアカウントも付け替えられる（switch_project_sns_account と同じ）", async () => {
    const { targetId } = await scheduled(await account());
    await admin.from("post_targets").update({ status: "failed", error_message: "x" }).eq("id", targetId);
    const other = await account();
    expect((await admin.from("post_targets").update({ social_account_id: other }).eq("id", targetId)).error).toBeNull();
    expect((await row(targetId)).social_account_id).toBe(other);
  });

  it("SNS のアカウントを消すと、送った配信先のアカウントは外部キーで空になる（止まらない）", async () => {
    const acc = await account();
    const { targetId } = await scheduled(acc);
    await admin.from("post_targets").update({ status: "published", published_at: new Date().toISOString() }).eq("id", targetId);
    expect((await admin.from("social_accounts").delete().eq("id", acc)).error).toBeNull();
    expect(await row(targetId)).toMatchObject({ status: "published", social_account_id: null, hashtags: ["パン"] });
  });
});

describe("タグの check（参考 I1）", () => {
  it("配信先のタグ: ゼロ幅の文字・2 次元の配列を弾く", async () => {
    const { targetId } = await scheduled(await account());
    for (const bad of [[`パ${ZWSP}ン`], ["﻿x"], ["a‍b"], [["a", "b"]]]) {
      const { error } = await alice.from("post_targets").update({ hashtags: bad as never }).eq("id", targetId);
      expect(error?.code, JSON.stringify(bad)).toBe("23514");
    }
    expect((await alice.from("post_targets").update({ hashtags: ["焼きたて_パン"] }).eq("id", targetId)).error).toBeNull();
  });

  it("フォーマットのタグ: ゼロ幅の文字を弾く", async () => {
    const ins = (hashtags: unknown) => alice.from("post_formats").insert({ project_id: projectId, name: `f-${randomUUID().slice(0, 6)}`, body: "y", hashtags: hashtags as never });
    for (const bad of [{ all: [`パ${ZWSP}ン`] }, { x: ["⁠a"] }, { all: [["a"]] }]) {
      expect((await ins(bad)).error?.code, JSON.stringify(bad)).toBe("23514");
    }
    expect((await ins({ all: ["パン"] })).error).toBeNull();
  });
});
