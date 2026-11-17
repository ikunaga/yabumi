import { describe, expect, it } from "vitest";
import { hashtagsInput } from "@/lib/post-formats/schema";
import { defaultTagInputs, defaultTagsFor, tagsAfterFormat, withDefaultTags } from "@/lib/projects/default-hashtags";

// プロジェクトの「いつものタグ」（2026-11-17 オーナーの依頼、案 A）の決まり
describe("いつものタグ", () => {
  const defaults = { all: ["パン屋", "天然酵母"], instagram: ["パン好きな人と繋がりたい"] };

  it("SNS だけのタグがあればそれ、なければ共通", () => {
    expect(defaultTagsFor(defaults, "instagram")).toEqual(["パン好きな人と繋がりたい"]);
    expect(defaultTagsFor(defaults, "x")).toEqual(["パン屋", "天然酵母"]);
    expect(defaultTagsFor({}, "x")).toEqual([]);
  });

  it("新しい投稿の欄の初期値は「#a #b」で、タグのない SNS は持たない", () => {
    const v = defaultTagInputs({ x: ["a", "b"] });
    expect(v).toEqual({ x: "#a #b" });
    expect(defaultTagInputs(defaults).threads).toBe("#パン屋 #天然酵母");
    expect(defaultTagInputs({})).toEqual({});
  });

  it("フォーマットにその SNS のタグがあればフォーマット、なければいつものタグに戻す", () => {
    const format = { x: ["今日の一枚"] };
    expect(tagsAfterFormat(format, defaults, "x")).toEqual(["今日の一枚"]);
    expect(tagsAfterFormat(format, defaults, "threads")).toEqual(["パン屋", "天然酵母"]);
    expect(tagsAfterFormat({ all: ["共通"] }, defaults, "instagram")).toEqual(["共通"]);
    expect(tagsAfterFormat({}, {}, "x")).toEqual([]);
  });

  it("下書きを作るときは、本文（SNS ごとの文面があればそれ）にもあるタグを足さない", () => {
    const out = withDefaultTags(
      [
        { sns: "x" as const, body_override: null, social_account_id: "a" },
        { sns: "threads" as const, body_override: "朝の様子 #天然酵母", social_account_id: "b" },
      ],
      "新しいパン #パン屋",
      defaults,
    );
    expect(out[0].hashtags).toEqual(["天然酵母"]);
    expect(out[1].hashtags).toEqual(["パン屋"]);
    expect(out[0].social_account_id).toBe("a");
  });

  it("保存の決まりは投稿のフォーマットのタグと同じ（6 個以上・記号・知らないキーは断るか捨てる）", () => {
    expect(hashtagsInput.safeParse({ all: "#a #b" }).data).toEqual({ all: ["a", "b"] });
    expect(hashtagsInput.safeParse({ x: "#a #b #c #d #e #f" }).success).toBe(false);
    expect(hashtagsInput.safeParse({ x: "#a-b" }).success).toBe(false);
    expect(hashtagsInput.safeParse({ x: "#a​b" }).success).toBe(false);
    expect(hashtagsInput.safeParse({ mastodon: "#a" }).data).toEqual({});
    expect(hashtagsInput.safeParse({ all: "" }).data).toEqual({});
  });
});
