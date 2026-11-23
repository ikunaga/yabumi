// 下書きの数（countUnsentDrafts）: 概要・カレンダー・投稿をつくるの「下書き n 件」と、下書きの一覧で同じ決め方。他人の下書きは数えない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadCalendarStats } from "@/lib/calendar/stats";
import { countUnsentDrafts } from "@/lib/posts/drafts";
import { listDrafts } from "@/lib/posts/queries";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));
// 読み込みには利用者の権限のクライアントを渡すので、cookie から作るクライアントは使わない
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("テストではクライアントを渡す");
  },
}));

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

async function post(status: "draft" | "scheduled", targets: ("pending" | "published" | "failed" | "awaiting_approval" | "publishing")[], body = "本文") {
  const { data, error } = await admin.from("posts").insert({ owner_id: aliceId, project_id: projectId, body, status, planned_at: status === "scheduled" ? "2099-01-01T00:00:00Z" : null }).select("id").single();
  if (error) throw error;
  const sns = ["x", "threads", "instagram"];
  if (targets.length) {
    const t = await admin.from("post_targets").insert(targets.map((s, i) => ({ owner_id: aliceId, post_id: data.id, sns: sns[i], status: s, published_at: s === "published" ? new Date().toISOString() : null })));
    if (t.error) throw t.error;
  }
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "下書き" }).select("id").single()).data!.id;
  await post("draft", []); // 送り先なし
  await post("draft", ["pending", "pending"]); // 送り先を選んだ下書き
  await post("draft", ["published", "pending"]); // 今すぐ送った（一部）
  await post("draft", ["failed"]); // 今すぐ送って失敗
  await post("scheduled", ["pending"]); // 予約
  await post("draft", ["awaiting_approval", "pending"], "自動投稿が下書きに回した投稿"); // X が確認待ちのまま下書きに回った（2026-11-23 本番）
  await post("draft", ["publishing"]); // 今すぐ送っている途中
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("下書きの数", () => {
  it("まだどこにも送っていない下書きだけを数える（概要とカレンダーで同じ）", async () => {
    // 送り先なし・送り先を選んだ下書き・確認待ちのまま下書きに回った投稿の 3 つ。今すぐ送った（途中・一部・失敗）と予約は入れない
    expect(await countUnsentDrafts(alice, projectId)).toBe(3);
    expect((await loadCalendarStats(projectId, "2099-01", alice)).drafts).toBe(3);
  });
  it("下書きの一覧にも、確認待ちのまま下書きに回った投稿が出る（数と同じ決め方）", async () => {
    const rows = await listDrafts(projectId, alice);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.body)).toContain("自動投稿が下書きに回した投稿");
  });
  it("他人の下書きは数えない", async () => {
    expect(await countUnsentDrafts(bob, projectId)).toBe(0);
  });
});
