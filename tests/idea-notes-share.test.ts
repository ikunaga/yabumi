// ネタ帳の共有の受け取り（本文のまとめ方、cookie と # の読み方）。docs/architecture.md の 4.26
import { describe, expect, it } from "vitest";
import { MAX_NOTE_CHARS, sharedText } from "@/lib/notes/rules";
import { SHARE_COOKIE_CHARS, decodeShareCookie, encodeShareCookie, textFromHash } from "@/lib/notes/share";

describe("共有で受け取ったもの", () => {
  it("タイトル・本文・URL を 1 つにまとめ、同じ文は重ねない", () => {
    expect(sharedText({ title: "記事の題名", text: "記事の題名 https://example.com/a", url: "https://example.com/a" })).toBe("記事の題名 https://example.com/a");
    expect(sharedText({ title: " ", text: "メモ", url: "https://example.com" })).toBe("メモ\nhttps://example.com");
    expect(sharedText({ text: "あ".repeat(MAX_NOTE_CHARS + 10) })).toHaveLength(MAX_NOTE_CHARS);
  });

  it("cookie は短く切って戻せる。壊れた値は読まない", () => {
    const raw = encodeShareCookie({ text: "あ".repeat(1000), hadFile: true });
    expect(encodeURIComponent(raw).length).toBeLessThan(4000);
    expect(decodeShareCookie(raw)).toEqual({ text: "あ".repeat(SHARE_COOKIE_CHARS), hadFile: true });
    expect(decodeShareCookie("{broken")).toBeNull();
    expect(decodeShareCookie(undefined)).toBeNull();
  });

  it("# のあと（ショートカット・ブックマークレット）から本文を読む", () => {
    expect(textFromHash("#text=%E6%9C%9D%E3%81%AE%E3%83%A1%E3%83%A2")).toBe("朝のメモ");
    expect(textFromHash("#title=T&url=https%3A%2F%2Fexample.com&text=")).toBe("T\nhttps://example.com");
    expect(textFromHash("")).toBe("");
  });
});
