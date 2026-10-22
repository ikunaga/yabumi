import { describe, expect, it } from "vitest";
import { SNS_KEYS } from "@/lib/sns";
import { PREVIEW, foldText, previewSegments, previewTabs } from "@/lib/sns/preview";

describe("見え方のタブ", () => {
  it("送り先に選んだ SNS だけを並び順で並べる。見ている SNS がなければ最初のタブ", () => {
    expect(previewTabs(["instagram", "x"], "x")).toEqual({ tabs: ["x", "instagram"], active: "x" });
    expect(previewTabs(["threads", "instagram"], "x")).toEqual({ tabs: ["threads", "instagram"], active: "threads" });
    expect(previewTabs(["threads", "instagram"], "instagram").active).toBe("instagram");
  });

  it("選んでいなければ、すべての SNS を見られる", () => {
    expect(previewTabs([], "facebook")).toEqual({ tabs: SNS_KEYS, active: "facebook" });
  });

  it("すべての SNS に見え方がある", () => {
    for (const sns of SNS_KEYS) expect(PREVIEW[sns].note).not.toBe("");
  });
});

describe("折りたたみ", () => {
  const ig = PREVIEW.instagram.fold;

  it("X・Threads は折りたたまず、長い本文も改行も全文を出す", () => {
    const long = "あ".repeat(400) + "\n\n" + "https://example.com/" + "a".repeat(80);
    expect(foldText(long, PREVIEW.x.fold)).toEqual({ shown: long, folded: false });
    expect(foldText(long, PREVIEW.threads.fold).folded).toBe(false);
  });

  it("Instagram は 2 行を超えたら折りたたむ（改行で数える）", () => {
    expect(foldText("1 行目\n2 行目", ig)).toEqual({ shown: "1 行目\n2 行目", folded: false });
    expect(foldText("1 行目\n2 行目\n3 行目", ig)).toEqual({ shown: "1 行目\n2 行目", folded: true });
  });

  it("改行がなくても、1 行に入りきらない長さなら折り返しを数えて折りたたむ", () => {
    const r = foldText("あ".repeat(200), ig);
    expect(r.folded).toBe(true);
    expect([...r.shown].length).toBeLessThan(60);
  });

  it("Facebook は 5 行まで出す", () => {
    expect(foldText("1\n2\n3\n4\n5", PREVIEW.facebook.fold).folded).toBe(false);
    expect(foldText("1\n2\n3\n4\n5\n6", PREVIEW.facebook.fold)).toEqual({ shown: "1\n2\n3\n4\n5", folded: true });
  });
});

describe("URL とハッシュタグ", () => {
  it("URL とハッシュタグを分ける（日本語のハッシュタグ、句読点で切る）", () => {
    expect(previewSegments("見てください https://example.com/a?b=1 #個人開発、#indiedev")).toEqual([
      { kind: "text", value: "見てください " },
      { kind: "url", value: "https://example.com/a?b=1" },
      { kind: "text", value: " " },
      { kind: "tag", value: "#個人開発" },
      { kind: "text", value: "、" },
      { kind: "tag", value: "#indiedev" },
    ]);
  });

  it("URL もハッシュタグもなければ、そのまま", () => {
    expect(previewSegments("ふつうの文\n2 行目")).toEqual([{ kind: "text", value: "ふつうの文\n2 行目" }]);
  });
});
