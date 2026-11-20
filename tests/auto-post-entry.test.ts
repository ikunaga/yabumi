// 自動の投稿の入口（docs/design/auto-post.md の 1.2・1.6）: 概要の帯・カレンダーの札。DB に触れない決まりだけ
import { describe, expect, it, vi } from "vitest";
import type { AutoPlan, UpcomingAutoRun } from "@/lib/auto-post/types";
import type { PostRow, PostTargetRow, TargetStatus } from "@/lib/posts/queries";
import type { SnsKey } from "@/lib/sns";
import { nextRunLabel, overviewAutoBand } from "@/lib/auto-post/entry";
import { autoReviewWarning, autoRunsRange, firstReviewPostIds, plannedAutoChips, postChipHref } from "@/lib/calendar/auto-chips";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
const { displayStatus, postWarning } = await import("@/components/posts/post-chip");

const NOW = new Date("2026-11-16T03:00:00Z"); // 日本時間 11/16 12:00
const base = "/projects/p1";

function plan(over: Partial<AutoPlan>): AutoPlan {
  return {
    id: "plan-a",
    projectId: "p1",
    name: "ネタ帳から",
    kind: "notes",
    materials: {},
    targets: { threads: "auto" },
    xLink: "never",
    schedule: { weekdays: [2, 5], time: "19:00", every_weeks: 1, start: "2026-11-16" },
    instructions: [],
    image: null,
    leadHours: 24,
    firstReview: false,
    status: "active",
    stopReason: null,
    failStreak: 0,
    consentedAt: "2026-11-16T00:00:00Z",
    createdAt: "2026-11-16T00:00:00Z",
    updatedAt: "2026-11-16T00:00:00Z",
    ...over,
  };
}
function run(over: Partial<UpcomingAutoRun>): UpcomingAutoRun {
  return { runId: "", planId: "plan-a", planName: "ネタ帳から", dueAt: "2026-11-17T00:00:00Z", status: "waiting", postId: null, sns: ["threads"], ...over };
}
function target(sns: SnsKey, status: TargetStatus = "pending"): PostTargetRow {
  return { id: `${sns}-t`, sns, status, body_override: null, title: null, external_post_id: null, external_url: null, sns_removed_at: null, error_message: null, published_at: null, next_attempt_at: null, quote_post_id: null, hashtags: [] };
}
function post(over: Partial<PostRow>): PostRow {
  return { id: "post-1", body: "本文", planned_at: "2026-11-17T00:00:00Z", status: "scheduled", targets: [target("threads")], images: 0, textOrigin: "ai", formatId: null, roadmapItemId: null, autoRunId: "run-1", ...over };
}

describe("概要の帯", () => {
  it("回し方が 1 つもなければ出さない", () => {
    expect(overviewAutoBand([], [], 0, NOW)).toBeNull();
  });

  it("動いている数・次の回（同じ時刻の送り先はまとめる）・確かめ待ち", () => {
    const band = overviewAutoBand(
      [plan({}), plan({ id: "plan-b", name: "商品の紹介", targets: { x: "review" } }), plan({ id: "plan-c", status: "paused" })],
      [
        run({ dueAt: "2026-11-18T10:00:00Z" }),
        run({ planId: "plan-b", dueAt: "2026-11-17T00:00:00Z", sns: ["x"] }),
        run({ dueAt: "2026-11-17T00:00:00Z", sns: ["threads"] }),
        // 止めた回し方の回・下書きに回した回・過ぎた回は数えない
        run({ planId: "plan-c", dueAt: "2026-11-16T05:00:00Z" }),
        run({ dueAt: "2026-11-16T04:00:00Z", status: "held" }),
        run({ dueAt: "2026-11-16T02:00:00Z" }),
      ],
      2,
      NOW,
    );
    expect(band).toEqual({ active: 2, paused: 1, next: { label: "明日 09:00", sns: ["x", "threads"] }, review: 2, stopped: [] });
  });

  it("今日の回は「今日 18:00」、それより先は日付", () => {
    expect(nextRunLabel("2026-11-16T09:00:00Z", NOW)).toBe("今日 18:00");
    expect(nextRunLabel("2026-11-20T10:00:00Z", NOW)).toBe("11/20 19:00");
  });

  it("yabumi が止めた回し方は、理由つきで要確認に出す", () => {
    const band = overviewAutoBand([plan({ status: "stopped", stopReason: "disconnected" }), plan({ id: "plan-b", status: "stopped", stopReason: null })], [], 0, NOW);
    expect(band).toMatchObject({ active: 0, next: null });
    expect(band?.stopped).toEqual([
      { id: "plan-a", name: "ネタ帳から", reason: "SNS のつながりが切れています" },
      { id: "plan-b", name: "ネタ帳から", reason: "止まりました" },
    ]);
  });
});

describe("カレンダーの自動の回", () => {
  it("作る前の回だけを点線の札にし、押すと回し方の画面", () => {
    const chips = plannedAutoChips(
      [run({}), run({ runId: "r2", status: "generating", dueAt: "2026-11-20T10:00:00Z" }), run({ runId: "r3", status: "scheduled", postId: "post-1" }), run({ runId: "r4", status: "held", postId: "post-2" })],
      base,
    );
    expect(chips).toEqual([
      { id: "plan-a|2026-11-17T00:00:00Z", planId: "plan-a", dueAt: "2026-11-17T00:00:00Z", href: "/projects/p1/auto/plan-a", title: "ネタ帳から", label: "自動（作る前）", sns: ["threads"] },
      { id: "r2", planId: "plan-a", dueAt: "2026-11-20T10:00:00Z", href: "/projects/p1/auto/plan-a", title: "ネタ帳から", label: "自動（作る前）", sns: ["threads"] },
    ]);
  });

  it("確かめ待ちの投稿は確かめ待ちの画面へ、ほかは投稿の画面へ", () => {
    const first = firstReviewPostIds([run({ status: "review", postId: "post-1" }), run({ status: "scheduled", postId: "post-2" })]);
    expect([...first]).toEqual(["post-1"]);
    expect(postChipHref(post({ status: "draft" }), base, first)).toBe("/projects/p1/auto/review");
    expect(autoReviewWarning(post({ status: "draft" }), first)).toBe("最初の回の確認待ちです");
    expect(postChipHref(post({ id: "post-2", targets: [target("threads"), target("x", "awaiting_approval")] }), base, first)).toBe("/projects/p1/auto/review");
    expect(postChipHref(post({ id: "post-2" }), base, first)).toBe("/projects/p1/posts/post-2");
    // 手で作った投稿は、回の状態に関係なく投稿の画面
    expect(postChipHref(post({ autoRunId: null }), base, first)).toBe("/projects/p1/posts/post-1");
    expect(autoReviewWarning(post({ autoRunId: null }), first)).toBeNull();
  });

  it("読む範囲は今から（過ぎた週は読まない）", () => {
    expect(autoRunsRange("2026-11-09T15:00:00Z", "2026-11-16T15:00:00Z", NOW)).toEqual({ from: NOW, until: new Date("2026-11-16T15:00:00Z") });
    expect(autoRunsRange("2026-11-02T15:00:00Z", "2026-11-09T15:00:00Z", NOW)).toBeNull();
    expect(autoRunsRange("2026-11-16T15:00:00Z", "2026-11-23T15:00:00Z", NOW)?.from).toEqual(new Date("2026-11-16T15:00:00Z"));
  });
});

describe("確かめ待ちは予約に見せない（カレンダーの数と同じ）", () => {
  it("送り先がどれも確かめ待ちなら下書きの見え方で、注意に出す", () => {
    const p = post({ targets: [target("x", "awaiting_approval")] });
    expect(displayStatus(p)).toBe("draft");
    expect(postWarning(p)).toBe("X は確認待ちです");
  });

  it("ほかの SNS が予約なら予約のまま、確かめ待ちの SNS を注意に出す", () => {
    const p = post({ targets: [target("threads"), target("x", "awaiting_approval")] });
    expect(displayStatus(p)).toBe("scheduled");
    expect(postWarning(p)).toBe("X は確認待ちです");
  });

  it("飛ばした自動投稿（下書きに戻った投稿）の確認待ちは出さない。札は投稿の画面へ（2026-11-21 PM の指摘）", () => {
    const skipped = post({ id: "post-3", status: "draft", targets: [target("threads"), target("x", "awaiting_approval")] });
    expect(postWarning(skipped)).toBeNull();
    expect(postChipHref(skipped, base, new Set())).toBe("/projects/p1/posts/post-3");
    // 1 回目の確認待ち（下書きのまま回が review）は、今までどおり確認の画面へ
    expect(postChipHref(post({ id: "post-3", status: "draft" }), base, new Set(["post-3"]))).toBe("/projects/p1/auto/review");
  });

  it("確かめ待ちのない投稿は今までどおり", () => {
    expect(displayStatus(post({}))).toBe("scheduled");
    expect(displayStatus(post({ targets: [target("threads", "published")] }))).toBe("posted");
    expect(postWarning(post({}))).toBeNull();
  });
});
