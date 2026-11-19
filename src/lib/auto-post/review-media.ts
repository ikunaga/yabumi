import { SNS, type SnsKey } from "@/lib/sns";

// 確かめる画面に出す、その回に添えた画像・動画（docs/design/auto-post.md の 1.6。X の開発者ポリシー「Show exactly what will be published」）。
// 画像・動画は投稿ごとに持ち、どの SNS に何が届くかは送信ジョブ（src/lib/sns/publisher.ts）の決まりと同じにする:
// 動画があれば動画だけ（自動で送る SNS）、なければ画像（画像を送れる SNS だけ）。手で投稿の SNS には何も送らない

export type ReviewImage = { id: string; url: string | null; altText: string; width: number; height: number };
export type ReviewVideo = { id: string; url: string | null; width: number; height: number; durationMs: number };
export type ReviewMedia = { images: ReviewImage[]; video: ReviewVideo | null };

export const NO_MEDIA: ReviewMedia = { images: [], video: null };

// unsupported: 動画を送れない SNS（送信ジョブは失敗にする）。overLimit: 画像の枚数がその SNS の上限を超える（同じく失敗にする）
export type SnsMedia =
  | { kind: "none" }
  | { kind: "video"; video: ReviewVideo; unsupported: boolean }
  | { kind: "images"; images: ReviewImage[]; overLimit: boolean; max: number };

export function mediaForSns(sns: SnsKey, media: ReviewMedia): SnsMedia {
  const spec = SNS[sns];
  if (spec.delivery !== "auto") return { kind: "none" };
  if (media.video) return { kind: "video", video: media.video, unsupported: !spec.video };
  if (spec.maxImages > 0 && media.images.length > 0) return { kind: "images", images: media.images, overLimit: media.images.length > spec.maxImages, max: spec.maxImages };
  return { kind: "none" };
}
