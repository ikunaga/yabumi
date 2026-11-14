// TikTok に写真を渡す入口のトークンと、1080 に縮める（docs/design/tiktok.md の 2.）
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { TIKTOK_MAX_EDGE, hashTicketToken, newTicketToken, shrinkJpeg, tokenFromFile } from "@/lib/sns/tiktok/media";

const image = (width: number, height: number) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i / 4) % 255;
    data[i + 1] = 120;
    data[i + 2] = 60;
    data[i + 3] = 255;
  }
  return new Uint8Array(jpeg.encode({ data, width, height }, 90).data);
};

describe("入口のトークン", () => {
  it("推測できない乱数（32 バイト）で、毎回違う。DB には SHA-256 だけを持つ", () => {
    const a = newTicketToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newTicketToken()).not.toBe(a);
    expect(hashTicketToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTicketToken(a)).not.toContain(a);
  });
  it("「<トークン>.jpg」の形だけを受け付ける", () => {
    const t = newTicketToken();
    expect(tokenFromFile(`${t}.jpg`)).toBe(t);
    expect(tokenFromFile(t)).toBeNull();
    expect(tokenFromFile(`${t}.png`)).toBeNull();
    expect(tokenFromFile("../../etc.jpg")).toBeNull();
    expect(tokenFromFile("short.jpg")).toBeNull();
  });
});

describe("1080 に縮める", () => {
  it("長い辺が 1080 を超えるときだけ、長い辺 1080 に縮める（縦横比は同じ）", () => {
    const out = jpeg.decode(shrinkJpeg(image(2048, 1536)));
    expect(Math.max(out.width, out.height)).toBe(TIKTOK_MAX_EDGE);
    expect(out.width).toBe(1080);
    expect(out.height).toBe(810);
    const tall = jpeg.decode(shrinkJpeg(image(1200, 1500)));
    expect([tall.width, tall.height]).toEqual([864, 1080]);
  });
  it("小さい画像はそのまま", () => {
    const small = image(800, 600);
    expect(shrinkJpeg(small)).toBe(small);
  });
});
