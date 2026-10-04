// 予約時刻を過ぎても送られていない投稿の検出（送信ジョブが止まったときに気づくため）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overduePostIds } from "@/lib/posts/overdue";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
const now = new Date("2026-10-04T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

async function post(plannedMinutesAgo: number, status: "draft" | "scheduled", target: { status: string; next_attempt_at?: string | null }) {
  const { data } = await admin.from("posts").insert({ owner_id: aliceId, project_id: projectId, body: "x", planned_at: minutesAgo(plannedMinutesAgo), status }).select("id").single();
  await admin.from("post_targets").insert({ owner_id: aliceId, post_id: data!.id, sns: "threads", ...target });
  return data!.id;
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

describe("送られていない予約", () => {
  it("予約時刻を 10 分以上過ぎて、まだ送られていないものだけを拾う", async () => {
    const overdue = await post(30, "scheduled", { status: "pending" });
    await post(5, "scheduled", { status: "pending" }); // まだ 10 分たっていない
    await post(30, "draft", { status: "pending" }); // 下書きは送らない
    await post(30, "scheduled", { status: "published" }); // 送信済み
    await post(30, "scheduled", { status: "failed" }); // 失敗は別の表示
    await post(30, "scheduled", { status: "pending", next_attempt_at: minutesAgo(-3) }); // やり直しを待っている
    const waitedTooLong = await post(60, "scheduled", { status: "pending", next_attempt_at: minutesAgo(20) });

    const ids = await overduePostIds(alice, projectId, now);
    expect(ids.sort()).toEqual([overdue, waitedTooLong].sort());
  });

  it("他人の投稿は拾わない", async () => {
    expect(await overduePostIds(bob, projectId, now)).toEqual([]);
  });
});
