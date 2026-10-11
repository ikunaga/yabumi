// 画像の中身の確認と、位置情報などのメタデータの削除（docs/architecture.md の 4.18）
import { describe, expect, it } from "vitest";
import { InvalidImageError, sanitizeJpeg } from "@/lib/media/jpeg";
import { checkTarget } from "@/lib/sns";
import { isOwnMediaPath, lacksImageScope, mediaPath } from "@/lib/media/rules";
import { COMMENT_MARK, EXIF_GPS_MARK, includesAscii, testJpeg } from "./helpers/jpeg";

describe("sanitizeJpeg", () => {
  it("Exif（位置情報）とコメントを消し、画像の本体と大きさは残す", () => {
    const input = testJpeg({ width: 1200, height: 900 });
    expect(includesAscii(input, EXIF_GPS_MARK)).toBe(true);
    const out = sanitizeJpeg(input);
    expect(out).toMatchObject({ width: 1200, height: 900 });
    expect(includesAscii(out.bytes, EXIF_GPS_MARK)).toBe(false);
    expect(includesAscii(out.bytes, "Exif")).toBe(false);
    expect(includesAscii(out.bytes, COMMENT_MARK)).toBe(false);
    expect(includesAscii(out.bytes, "JFIF")).toBe(true);
    // 本体（SOS から終わりまで）はそのまま
    const tail = (b: Uint8Array) => Buffer.from(b.subarray(b.indexOf(0xda) - 1));
    expect(tail(out.bytes).equals(tail(input))).toBe(true);
    expect([...out.bytes.subarray(-2)]).toEqual([0xff, 0xd9]);
  });

  it("メタデータがなければ中身は変わらない", () => {
    const input = testJpeg({ exif: false, comment: false });
    expect(Buffer.from(sanitizeJpeg(input).bytes).equals(Buffer.from(input))).toBe(true);
  });

  it("JPEG でないもの・壊れたものは受け付けない（拡張子ではなく中身で見る）", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(() => sanitizeJpeg(png)).toThrow(InvalidImageError);
    expect(() => sanitizeJpeg(new TextEncoder().encode("<svg></svg>"))).toThrow(InvalidImageError);
    const full = testJpeg();
    expect(() => sanitizeJpeg(full.subarray(0, 30))).toThrow(InvalidImageError);
    // 大きさ（SOF）がない
    expect(() => sanitizeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]))).toThrow(InvalidImageError);
    // 長さが足りない区切り
    expect(() => sanitizeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0]))).toThrow(InvalidImageError);
  });
});

describe("画像の決まり", () => {
  it("SNS ごとの枚数: X は 4 枚まで、Threads は 20 枚まで。動画だけ・手で投稿の SNS は画像を数えない", () => {
    expect(checkTarget("x", "本文", { images: 4, videos: 0 }).issues).toEqual([]);
    expect(checkTarget("x", "本文", { images: 5, videos: 0 }).issues).toEqual(["too_many_images"]);
    expect(checkTarget("threads", "本文", { images: 10, videos: 0 }).issues).toEqual([]);
    expect(checkTarget("instagram", "本文", { images: 1, videos: 0 }).issues).toEqual([]);
    expect(checkTarget("instagram", "本文", { images: 11, videos: 0 }).issues).toEqual(["too_many_images"]);
    expect(checkTarget("note", "本文", { images: 30, videos: 0 }, "題").issues).toEqual([]);
  });

  it("置き場所は本人のフォルダの UUID.jpg だけ", () => {
    const owner = "11111111-1111-4111-8111-111111111111";
    const id = "22222222-2222-4222-8222-222222222222";
    expect(isOwnMediaPath(owner, mediaPath(owner, id))).toBe(true);
    expect(isOwnMediaPath(owner, `${owner}/../x/${id}.jpg`)).toBe(false);
    expect(isOwnMediaPath(owner, `33333333-3333-4333-8333-333333333333/${id}.jpg`)).toBe(false);
    expect(isOwnMediaPath(owner, `${owner}/${id}.png`)).toBe(false);
  });

  it("X は media.write がないと画像を送れない", () => {
    expect(lacksImageScope("x", ["tweet.write"])).toBe(true);
    expect(lacksImageScope("x", ["tweet.write", "media.write"])).toBe(false);
    expect(lacksImageScope("threads", [])).toBe(false);
  });
});
