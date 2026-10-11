import { describe, expect, it } from "vitest";
import { displayLength } from "@/lib/sns";
import { findXUrls, hasXUrl, xWeightedLength } from "@/lib/sns/x-text";
import { xPostOperation } from "@/lib/sns/x/pricing";

describe("X の URL の見つけ方", () => {
  it("https:// から始まるものは URL。日本語や句読点が続いたら、そこで終わる", () => {
    expect(findXUrls("見て https://example.com/a?b=1。").map((u) => u.url)).toEqual(["https://example.com/a?b=1"]);
    expect(findXUrls("https://example.comです").map((u) => u.url)).toEqual(["https://example.com"]);
  });

  it("https:// のない一般のドメイン（.com など）も URL", () => {
    expect(hasXUrl("詳しくは yabumi.com で")).toBe(true);
    expect(hasXUrl("詳しくはyabumi.app")).toBe(true);
    expect(hasXUrl("github.com/ikunaga/yabumi を公開")).toBe(true);
  });

  it("国のドメイン（2 文字）は、パスがあるときだけ URL。よく使うもの（.io・.ai など）はパスがなくても URL", () => {
    expect(hasXUrl("README.md を書いた")).toBe(false);
    expect(hasXUrl("example.jp")).toBe(true);
    expect(hasXUrl("example.de")).toBe(false);
    expect(hasXUrl("example.de/page")).toBe(true);
    expect(hasXUrl("yabumi.io")).toBe(true);
  });

  it("URL ではないもの: ファイル名、バージョン、メールアドレス、https:// だけ", () => {
    expect(hasXUrl("Next.js と Node.js で作った")).toBe(false);
    expect(hasXUrl("v1.2.3 を出した")).toBe(false);
    expect(hasXUrl("連絡は me@example.com へ")).toBe(false);
    expect(hasXUrl("https:// だけ")).toBe(false);
  });
});

describe("X の重み付きの文字数", () => {
  it("半角は 1、日本語は 2、URL は長さに関係なく 23", () => {
    expect(xWeightedLength("abc")).toBe(3);
    expect(xWeightedLength("あいう")).toBe(6);
    expect(xWeightedLength("見て yabumi.com")).toBe(4 + 1 + 23);
    expect(xWeightedLength("https://apps.apple.com/jp/app/id1234567890")).toBe(23);
  });

  it("絵文字は、組み合わせたもの（家族・肌の色・国旗）も 1 つで 2", () => {
    expect(xWeightedLength("👍")).toBe(2);
    expect(xWeightedLength("👨‍👩‍👧")).toBe(2);
    expect(xWeightedLength("👍🏽")).toBe(2);
    expect(xWeightedLength("🇯🇵")).toBe(2);
  });

  it("NFC に正規化してから数える（e と、あとから付けたアクセント記号は「é」の 1 文字）", () => {
    expect(xWeightedLength("café")).toBe(4);
  });

  it("画面には全角換算（重みの半分を切り上げ）で出す。上限は 140", () => {
    expect(displayLength("x", "あ".repeat(140))).toBe(140);
    expect(displayLength("x", "a")).toBe(1);
  });
});

describe("X の投稿の費用の種類", () => {
  it("URL があれば post_with_url", () => {
    expect(xPostOperation("こんにちは")).toBe("post");
    expect(xPostOperation("こんにちは yabumi.com")).toBe("post_with_url");
  });
});
