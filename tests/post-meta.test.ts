// 分析の投稿の行に添える、送った日と SNS（src/lib/metrics/post-meta.ts）
import { describe, expect, it } from "vitest";
import { firstLine, postMeta } from "@/lib/metrics/post-meta";

describe("分析: 投稿の行", () => {
  it("送った日は、送った SNS のうちいちばん早い日時。SNS は決まった順で、送っていない・失敗したものは入れない", () => {
    const m = postMeta({
      body: "\n今月読んだ 5 冊をまとめました\n詳しくはプロフィールから",
      planned_at: "2026-10-12T08:00:00+09:00",
      post_targets: [
        { sns: "threads", status: "published", published_at: "2026-10-12T00:05:00Z" },
        { sns: "x", status: "published", published_at: "2026-10-11T23:00:00Z" },
        { sns: "instagram", status: "failed", published_at: null },
      ],
    });
    expect(m).toEqual({ title: "今月読んだ 5 冊をまとめました", sentAt: "2026-10-11T23:00:00Z", sns: ["x", "threads"] });
  });

  it("まだ送っていなければ予約の日時、投稿が見つからなければ日時も SNS もなし", () => {
    expect(postMeta({ body: "a", planned_at: "2026-10-20T00:00:00Z", post_targets: [{ sns: "x", status: "pending", published_at: null }] })).toEqual({ title: "a", sentAt: "2026-10-20T00:00:00Z", sns: [] });
    expect(postMeta(undefined)).toEqual({ title: "（本文なし）", sentAt: null, sns: [] });
  });

  it("1 行目が長ければ 40 字で切る", () => {
    expect(firstLine("あ".repeat(45))).toBe(`${"あ".repeat(40)}…`);
  });
});
