import { describe, expect, it } from "vitest";
import { mediaForSns, NO_MEDIA, type ReviewMedia } from "@/lib/auto-post/review-media";

// 確かめる画面で SNS ごとに見せる画像・動画は、送信ジョブ（src/lib/sns/publisher.ts）が送るものと同じ（docs/design/auto-post.md の「確かめる画面に画像・動画を出す」）
const img = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, url: `https://example.com/${i}.jpg`, altText: i === 0 ? "パンの写真" : "", width: 1080, height: 1350 }));
const video = { id: "v1", url: "https://example.com/v.mp4", width: 1080, height: 1920, durationMs: 15_000 };

describe("mediaForSns", () => {
  it("画像も動画もなければ何も出さない", () => {
    expect(mediaForSns("x", NO_MEDIA)).toEqual({ kind: "none" });
  });

  it("画像は、画像を送れる SNS にそのまま出す（画像の説明も持つ）", () => {
    const m = mediaForSns("x", { images: img(2), video: null });
    expect(m.kind).toBe("images");
    if (m.kind !== "images") return;
    expect(m.images.map((i) => i.altText)).toEqual(["パンの写真", ""]);
    expect(m.overLimit).toBe(false);
  });

  it("X は 4 枚まで。5 枚なら送れないことを出す", () => {
    const m = mediaForSns("x", { images: img(5), video: null });
    expect(m).toMatchObject({ kind: "images", overLimit: true, max: 4 });
    expect(mediaForSns("threads", { images: img(5), video: null })).toMatchObject({ kind: "images", overLimit: false });
  });

  it("動画があれば、画像ではなく動画だけ（送信ジョブと同じ）", () => {
    const media: ReviewMedia = { images: img(1), video };
    expect(mediaForSns("x", media)).toEqual({ kind: "video", video, unsupported: false });
    expect(mediaForSns("instagram", media)).toMatchObject({ kind: "video", unsupported: false });
  });

  it("動画を送れない SNS（TikTok）は、そのままでは送れないことを出す", () => {
    expect(mediaForSns("tiktok", { images: [], video })).toMatchObject({ kind: "video", unsupported: true });
  });

  it("画像を送らない SNS（YouTube）・手動で投稿の SNS（note）には出さない", () => {
    expect(mediaForSns("youtube", { images: img(1), video: null })).toEqual({ kind: "none" });
    expect(mediaForSns("note", { images: img(1), video: null })).toEqual({ kind: "none" });
    expect(mediaForSns("note", { images: [], video })).toEqual({ kind: "none" });
  });
});
