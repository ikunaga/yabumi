// カレンダーの投稿の注意（src/components/posts/post-chip.tsx の postWarning）: 画像の枚数を見て判定し、予約と下書きだけに出す
// （2026-11-05 オーナーの指摘: 画像を付けて投稿済みの Instagram に「Instagram は画像が未設定です」と出ていた）
import { describe, expect, it, vi } from "vitest";
import type { PostRow, PostTargetRow, TargetStatus } from "@/lib/posts/queries";
import type { SnsKey } from "@/lib/sns";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const { postWarning } = await import("@/components/posts/post-chip");

function target(sns: SnsKey, status: TargetStatus = "pending"): PostTargetRow {
  return { id: `${sns}-t`, sns, status, body_override: null, title: null, external_post_id: null, external_url: null, sns_removed_at: null, error_message: null, published_at: status === "published" ? "2026-11-04T01:00:00Z" : null, next_attempt_at: null };
}
function post(over: Partial<PostRow>): PostRow {
  return { id: "p1", body: "金曜の朝だけ、カンパーニュを焼きます", planned_at: "2026-11-06T00:00:00Z", status: "scheduled", targets: [target("instagram")], images: 0, ...over };
}

describe("postWarning", () => {
  it("画像を付けた Instagram の予約には出さない", () => {
    expect(postWarning(post({ images: 1 }))).toBeNull();
  });

  it("画像のない Instagram の予約には出す", () => {
    expect(postWarning(post({ images: 0 }))).toBe("Instagram は画像が未設定です");
  });

  it("画像のない Instagram の下書きにも出す", () => {
    expect(postWarning(post({ status: "draft", images: 0 }))).toBe("Instagram は画像が未設定です");
  });

  it("投稿済みには出さない（画像の数が読めていなくても）", () => {
    expect(postWarning(post({ targets: [target("instagram", "published")], images: 0 }))).toBeNull();
    expect(postWarning(post({ targets: [target("instagram", "published")], images: 2 }))).toBeNull();
  });

  it("失敗した投稿には出さない（失敗の印を出す）", () => {
    expect(postWarning(post({ targets: [target("instagram", "failed")], images: 0 }))).toBeNull();
  });

  it("一部の SNS だけ送った予約は、まだ送っていない SNS だけを見る", () => {
    expect(postWarning(post({ targets: [target("instagram", "published"), target("x")], images: 0 }))).toBeNull();
    expect(postWarning(post({ targets: [target("x", "published"), target("instagram")], images: 0 }))).toBe("Instagram は画像が未設定です");
  });

  it("全部の SNS で取り消したもの（下書きの扱い）には出さない", () => {
    expect(postWarning(post({ targets: [target("instagram", "deleted")], images: 0 }))).toBeNull();
  });

  it("文字数オーバーは、画像があっても出す", () => {
    expect(postWarning(post({ body: "あ".repeat(141), targets: [target("x")], images: 1 }))).toBe("X は文字数オーバーです");
  });
});
