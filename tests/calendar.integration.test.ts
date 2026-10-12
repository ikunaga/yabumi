// カレンダーの月の表示: 日ごとの投稿の数を DB で数える（calendar_day_counts）。日本時間で区切り、本人の投稿だけを数える
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { monthGrid, startOfYmd, addDays } from "@/lib/time";
import { deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

async function draftAt(plannedIso: string) {
  const { error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: `下書き ${plannedIso}`,
    p_planned_at: plannedIso,
    p_status: "draft",
    p_targets: [],
  });
  if (error) throw error;
}

// 2026 年 10 月の表示のマス（9/28〜11/8）
const grid = monthGrid("2026-10");
const range = { p_from: startOfYmd(grid[0]).toISOString(), p_to: startOfYmd(addDays(grid[41], 1)).toISOString() };

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  const { data, error } = await alice.from("projects").insert({ name: "カレンダー" }).select("id").single();
  if (error) throw error;
  projectId = data.id;
  await draftAt("2026-10-31T14:59:00Z"); // 日本時間 10/31 23:59
  await draftAt("2026-10-31T15:00:00Z"); // 日本時間 11/1 0:00（月またぎ）
  await draftAt("2026-10-13T15:30:00Z"); // 日本時間 10/14 0:30（UTC では 10/13）
  for (let i = 0; i < 7; i++) await draftAt(`2026-10-20T0${i}:00:00Z`); // 日本時間 10/20 に 7 件
  await draftAt("2026-09-27T14:59:00Z"); // 日本時間 9/27 23:59（マスの前日なので数えない）
  await draftAt("2026-09-27T15:00:00Z"); // 日本時間 9/28 0:00（マスの最初の日）
  await draftAt("2026-11-08T15:00:00Z"); // 日本時間 11/9 0:00（マスの次の日なので数えない）
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("日ごとの投稿の数", () => {
  it("日本時間の日付で区切り、前後の月の日も数える。マスの外は数えない", async () => {
    const { data, error } = await alice.rpc("calendar_day_counts", { p_project_id: projectId, ...range });
    if (error) throw error;
    expect(Object.fromEntries(data.map((r) => [r.day, r.posts]))).toEqual({
      "2026-09-28": 1,
      "2026-10-14": 1,
      "2026-10-20": 7,
      "2026-10-31": 1,
      "2026-11-01": 1,
    });
  });

  it("他人のプロジェクトの数は見えない（RLS）", async () => {
    const { data, error } = await bob.rpc("calendar_day_counts", { p_project_id: projectId, ...range });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
