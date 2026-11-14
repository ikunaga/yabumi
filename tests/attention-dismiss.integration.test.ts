// 概要の「● 要確認」の帯を × で閉じる（docs/architecture.md の 4.71）。閉じるのは close_attention だけで、画面に出していた項目だけを、
// 本人のプロジェクトの・いま要確認のものに限って閉じる。テストの行はこのファイルの利用者だけに作る（共有のローカル DB）
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withdrawUser } from "@/lib/account/withdraw";
import { attentionItems, isPostDismissed, isTodoDismissed, loadAttentionDismissals } from "@/lib/attention/dismissals";
import { overdueItems, type RoadmapItem } from "@/lib/roadmap/load";
import { X_BY_HAND_MESSAGE } from "@/lib/sns/x/send-rules";
import { adminClient, anonClient, deleteUser, goalLess, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));
let current: TestClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));
const { listDueManualPosts, listOverduePosts, listPostsNeedingAttention } = await import("@/lib/posts/queries");
const { loadCalendarStats } = await import("@/lib/calendar/stats");

const admin = adminClient();
const NOW = new Date();
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString();
const ym = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}`;

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let bobProject: string;

async function post(status: "draft" | "scheduled", plannedAt: string | null, targets: { sns: string; status: string; error_message?: string }[], project = projectId, owner = aliceId) {
  const { data, error } = await admin.from("posts").insert({ project_id: project, owner_id: owner, body: `投稿 ${randomUUID()}`, status, planned_at: plannedAt }).select("id").single();
  if (error) throw error;
  const rows = targets.map((t) => ({ post_id: data!.id, owner_id: owner, ...t }));
  const { data: ts, error: e2 } = await admin.from("post_targets").insert(rows).select("id");
  if (e2) throw e2;
  return { postId: data!.id, targetIds: ts!.map((t) => t.id) };
}

const target = async (id: string) => (await admin.from("post_targets").select("status, failed_at, attention_closed_at").eq("id", id).single()).data!;
const failedIds = async () => {
  current = alice;
  return (await listPostsNeedingAttention(projectId, 50)).flatMap((p) => p.targets.map((t) => t.id));
};
const close = (client: TestClient, items: unknown, project = projectId) => client.rpc("close_attention", { p_project_id: project, p_items: items as never });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "要確認" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "べつの人" }).select("id").single()).data!.id;
  current = alice;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("送れなかった投稿", () => {
  it("failed になると失敗した時刻が入る。閉じると帯とカレンダーの数から消え、投稿の失敗の記録は残る", async () => {
    const { targetIds: [t] } = await post("draft", hoursAgo(3), [{ sns: "threads", status: "pending" }]);
    await admin.from("post_targets").update({ status: "failed", error_message: "送れませんでした" }).eq("id", t);
    expect((await target(t)).failed_at).not.toBeNull();
    expect(await failedIds()).toContain(t);
    const before = (await loadCalendarStats(projectId, ym)).failed;

    const r = await close(alice, [{ kind: "failed", id: t }]);
    expect(r.error).toBeNull();
    expect(r.data).toBe(1);
    expect(await failedIds()).not.toContain(t);
    expect((await loadCalendarStats(projectId, ym)).failed).toBe(before - 1);
    // 失敗の記録（status・理由）はそのまま
    const row = (await admin.from("post_targets").select("status, error_message, attention_closed_at").eq("id", t).single()).data!;
    expect(row).toMatchObject({ status: "failed", error_message: "送れませんでした" });
    expect(row.attention_closed_at).not.toBeNull();
  });

  it("同じ配信先が送り直しのあとにまた失敗すると、新しい失敗としてまた出る", async () => {
    const { targetIds: [t] } = await post("draft", hoursAgo(3), [{ sns: "threads", status: "failed", error_message: "1 回目" }]);
    await close(alice, [{ kind: "failed", id: t }]);
    expect(await failedIds()).not.toContain(t);
    await admin.from("post_targets").update({ status: "pending" }).eq("id", t);
    await admin.from("post_targets").update({ status: "failed", error_message: "2 回目" }).eq("id", t);
    expect((await target(t)).attention_closed_at).toBeNull();
    expect(await failedIds()).toContain(t);
  });

  it("画面に出していなかった新しい失敗は、閉じても残る（出していた分だけ閉じる）", async () => {
    const { targetIds: [shown] } = await post("draft", hoursAgo(3), [{ sns: "threads", status: "failed", error_message: "x" }]);
    const { targetIds: [fresh] } = await post("draft", hoursAgo(1), [{ sns: "instagram", status: "failed", error_message: "y" }]);
    await close(alice, [{ kind: "failed", id: shown }]);
    const ids = await failedIds();
    expect(ids).not.toContain(shown);
    expect(ids).toContain(fresh);
  });

  it("失敗していない配信先・「X は手で投稿する」の X は、渡しても閉じない（黙って飛ばす）", async () => {
    const { targetIds: [pending, xHand] } = await post("scheduled", hoursAgo(1), [
      { sns: "threads", status: "pending" },
      { sns: "x", status: "failed", error_message: X_BY_HAND_MESSAGE },
    ]);
    const r = await close(alice, [{ kind: "failed", id: pending }, { kind: "failed", id: xHand }, { kind: "failed", id: "not-a-uuid" }, "ゴミ"]);
    expect(r.error).toBeNull();
    expect(r.data).toBe(0);
    expect((await target(pending)).attention_closed_at).toBeNull();
    expect((await target(xHand)).attention_closed_at).toBeNull();
  });

  it("他人の項目は閉じられない。他人のプロジェクトを渡すと 42501、自分のプロジェクトに他人の項目を混ぜても飛ばす", async () => {
    const { targetIds: [t] } = await post("draft", hoursAgo(2), [{ sns: "threads", status: "failed", error_message: "x" }]);
    const other = await close(bob, [{ kind: "failed", id: t }], projectId);
    expect(other.error?.code).toBe("42501");
    const mixed = await close(bob, [{ kind: "failed", id: t }], bobProject);
    expect(mixed.error).toBeNull();
    expect(mixed.data).toBe(0);
    expect((await target(t)).attention_closed_at).toBeNull();
    // ログインしていない人は呼べない
    expect((await close(anonClient(), [{ kind: "failed", id: t }])).error).not.toBeNull();
  });

  it("新しい列は利用者から直接は書けない", async () => {
    const { targetIds: [t] } = await post("draft", hoursAgo(2), [{ sns: "threads", status: "failed", error_message: "x" }]);
    await alice.from("post_targets").update({ attention_closed_at: NOW.toISOString() } as never).eq("id", t);
    await alice.from("post_targets").update({ failed_at: null } as never).eq("id", t);
    const row = await target(t);
    expect(row.attention_closed_at).toBeNull();
    expect(row.failed_at).not.toBeNull();
  });

  it("一覧は 200 件まで", async () => {
    const items = Array.from({ length: 201 }, () => ({ kind: "failed", id: randomUUID() }));
    expect((await close(alice, items)).error?.code).toBe("22023");
    expect((await close(alice, items.slice(0, 200))).error).toBeNull();
  });
});

describe("予約を過ぎた投稿・手で投稿する番", () => {
  it("閉じると帯から消える。予定時刻を動かすとまた出る", async () => {
    const at = hoursAgo(2);
    const { postId } = await post("scheduled", at, [{ sns: "threads", status: "pending" }]);
    const { postId: manualId } = await post("scheduled", at, [{ sns: "note", status: "pending" }]);
    current = alice;
    const shown = async () => {
      const d = await loadAttentionDismissals(alice, projectId);
      const overdue = await listOverduePosts(projectId, { hide: (p) => isPostDismissed(d, "overdue", p) });
      const manual = await listDueManualPosts(projectId, { hide: (p) => isPostDismissed(d, "manual", p) });
      return { overdue: overdue.map((p) => p.id), manual: manual.map((p) => p.id), all: [...overdue, ...manual] };
    };
    const first = await shown();
    expect(first.overdue).toContain(postId);
    expect(first.manual).toContain(manualId);

    // 予定時刻が合わないもの（画面を開いたあとに動かした）は閉じない
    expect((await close(alice, [{ kind: "overdue", id: postId, stamp: hoursAgo(5) }])).data).toBe(0);

    const items = attentionItems({ failed: [], overdue: first.all.filter((p) => p.id === postId), manualDue: first.all.filter((p) => p.id === manualId), overdueTodos: [] });
    expect((await close(alice, items)).data).toBe(2);
    const after = await shown();
    expect(after.overdue).not.toContain(postId);
    expect(after.manual).not.toContain(manualId);

    await admin.from("posts").update({ planned_at: hoursAgo(1) }).eq("id", postId);
    expect((await shown()).overdue).toContain(postId);
  });

  it("まだ予定時刻の来ていない投稿・他人の投稿は閉じない。直接は足せない", async () => {
    const future = new Date(NOW.getTime() + 3600_000).toISOString();
    const { postId } = await post("scheduled", future, [{ sns: "threads", status: "pending" }]);
    const bobPost = await post("scheduled", hoursAgo(2), [{ sns: "threads", status: "pending" }], bobProject, bobId);
    const r = await close(alice, [
      { kind: "overdue", id: postId, stamp: future },
      { kind: "overdue", id: bobPost.postId, stamp: hoursAgo(2) },
    ]);
    expect(r.data).toBe(0);
    const forged = await alice.from("attention_dismissals").insert({ owner_id: aliceId, project_id: projectId, kind: "overdue", post_id: postId, ref_at: future } as never);
    expect(forged.error).not.toBeNull();
  });
});

describe("予定日を過ぎたやること", () => {
  it("閉じると帯から消え、予定日を動かすとまた出る。今日より前でないものは閉じない", async () => {
    const { data, error } = await admin
      .from("roadmap_items")
      .insert(goalLess([{ project_id: projectId, owner_id: aliceId, title: "過ぎたやること", week_start: "2026-10-19", planned_on: "2026-10-20", kind: "post", status: "todo" }]))
      .select("id")
      .single();
    if (error) throw error;
    const itemId = (data as { id: string }).id;
    const item = { id: itemId, plannedOn: "2026-10-20" } as RoadmapItem;
    expect((await close(alice, [{ kind: "todo", id: itemId, stamp: "2026-10-21" }])).data).toBe(0);
    expect((await close(alice, [{ kind: "todo", id: itemId, stamp: "2026-10-20" }])).data).toBe(1);
    expect(isTodoDismissed(await loadAttentionDismissals(alice, projectId), item)).toBe(true);
    // 他人からは読めない
    expect((await bob.from("attention_dismissals").select("kind").eq("project_id", projectId)).data).toEqual([]);

    await admin.from("roadmap_items").update({ planned_on: "2026-10-22" }).eq("id", itemId);
    expect(isTodoDismissed(await loadAttentionDismissals(alice, projectId), { ...item, plannedOn: "2026-10-22" })).toBe(false);
    // overdueItems と合わせても出る（予定日を過ぎた投稿するやること）
    expect(overdueItems([{ ...item, kind: "post", status: "todo", plannedOn: "2026-10-22" } as RoadmapItem], "2026-11-14").length).toBe(1);
  });
  it("kind が空のやること（画面が投稿と推して出すもの）も閉じられる。済んだやることは閉じない（PMO の pc2・sp3）", async () => {
    const { data, error } = await admin
      .from("roadmap_items")
      .insert(
        goalLess([
          { project_id: projectId, owner_id: aliceId, title: "kind なし", week_start: "2026-10-19", planned_on: "2026-10-21", kind: null, status: "todo" },
          { project_id: projectId, owner_id: aliceId, title: "済んだ", week_start: "2026-10-19", planned_on: "2026-10-21", kind: "post", status: "done" },
        ]),
      )
      .select("id, title");
    if (error) throw error;
    const rows = data as { id: string; title: string }[];
    const blank = rows.find((r) => r.title === "kind なし")!.id;
    const done = rows.find((r) => r.title === "済んだ")!.id;
    const r = await close(alice, [
      { kind: "todo", id: blank, stamp: "2026-10-21" },
      { kind: "todo", id: done, stamp: "2026-10-21" },
    ]);
    expect(r.data).toBe(1);
    const d = await loadAttentionDismissals(alice, projectId);
    expect(isTodoDismissed(d, { id: blank, plannedOn: "2026-10-21" })).toBe(true);
    expect(isTodoDismissed(d, { id: done, plannedOn: "2026-10-21" })).toBe(false);
  });
});

describe("消えるとき", () => {
  it("投稿・プロジェクトを消すと、閉じた記録も消える。退会でも消える", async () => {
    const { data: u, error: e0 } = await admin.auth.admin.createUser({ email: `attn-${randomUUID()}@example.com`, password: randomUUID(), email_confirm: true });
    if (e0) throw e0;
    const carolId = u.user!.id;
    try {
      const p1 = (await admin.from("projects").insert({ name: "消す", owner_id: carolId }).select("id").single()).data!.id;
      const p2 = (await admin.from("projects").insert({ name: "残す", owner_id: carolId }).select("id").single()).data!.id;
      const mk = async (project: string) => {
        const { postId } = await post("scheduled", hoursAgo(2), [{ sns: "threads", status: "pending" }], project, carolId);
        await admin.from("attention_dismissals").insert({ owner_id: carolId, project_id: project, kind: "overdue", post_id: postId, ref_at: hoursAgo(2) });
        return postId;
      };
      const count = async () => (await admin.from("attention_dismissals").select("id", { count: "exact", head: true }).eq("owner_id", carolId)).count;
      const a = await mk(p2);
      await mk(p2);
      await mk(p1);
      expect(await count()).toBe(3);
      await admin.from("posts").delete().eq("id", a);
      expect(await count()).toBe(2);
      await admin.from("projects").delete().eq("id", p1);
      expect(await count()).toBe(1);
      await withdrawUser(admin, carolId, {});
      expect(await count()).toBe(0);
    } finally {
      await admin.auth.admin.deleteUser(carolId).catch(() => undefined);
    }
  });
});
