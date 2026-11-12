// 毎回付けるタグ（docs/architecture.md の 4.59）: 送る文の組み立て・欄の読み方・フォーマットのタグ・ステップの問題・控え・リセット・プロフィールのリンクの一言との並び
import { describe, expect, it } from "vitest";
import { hashtagInputProblem, hashtagLine, parseHashtagInput, targetText, withHashtags } from "@/lib/sns/hashtags";
import { checkTarget, countHashtags } from "@/lib/sns";
import { formatInputSchema, formatTagsFor, hasFormatHashtags, readFormatHashtags } from "@/lib/post-formats/schema";
import { problemsByStep } from "@/lib/posts/compose-steps";
import { postDraftBase, samePostDraft } from "@/lib/posts/post-draft";
import { composeChanges, type ComposeSnapshot } from "@/lib/posts/compose-reset";
import { withProfileLink } from "@/lib/posts/profile-link";
import { readFileSync } from "node:fs";

describe("送る文の組み立て", () => {
  it("本文の末尾の空白を落とし、空行をはさんでタグの行を足す", () => {
    expect(withHashtags("本文です\n\n", ["個人開発", "indiedev"])).toBe("本文です\n\n#個人開発 #indiedev");
    expect(withHashtags("本文です 　\t", ["a"])).toBe("本文です\n\n#a");
  });
  it("タグがなければ本文のまま（末尾も落とさない）。本文が空ならタグの行だけ", () => {
    expect(withHashtags("本文です\n", [])).toBe("本文です\n");
    expect(withHashtags("", ["a", "b"])).toBe("#a #b");
    expect(withHashtags(" \n　", ["a"])).toBe("#a");
  });
  it("保存した配信先は、SNS ごとの文面があればそれに足す", () => {
    expect(targetText("共通", { body_override: null, hashtags: ["a"] })).toBe("共通\n\n#a");
    expect(targetText("共通", { body_override: "X 用", hashtags: ["a"] })).toBe("X 用\n\n#a");
    expect(targetText("共通", { body_override: null })).toBe("共通");
  });
  it("プロフィールのリンクの一言は本文に入るので、タグの行はいつもその後ろ", () => {
    const ig = withProfileLink("新しい版を出しました https://example.com/app", "▶︎ アプリはプロフィールのリンクから");
    const text = withHashtags(ig, ["映画", "音楽"]);
    expect(text.split("\n").at(-1)).toBe("#映画 #音楽");
    expect(text).toContain("▶︎ アプリはプロフィールのリンクから\n\n#映画 #音楽");
  });
});

describe("タグの欄の読み方", () => {
  it("空白・読点・カンマで区切り、# を外し、同じタグは 1 つにする", () => {
    expect(parseHashtagInput("#個人開発 indiedev、＃IndieDev,#ねむログ　#個人開発")).toEqual({ tags: ["個人開発", "indiedev", "ねむログ"], invalid: [] });
    expect(parseHashtagInput("  ")).toEqual({ tags: [], invalid: [] });
  });
  it("記号の入った言葉・51 字以上はタグにできない。6 個以上は多すぎる", () => {
    expect(hashtagInputProblem("#a.b")).toMatch(/「a\.b」はタグにできません/);
    expect(hashtagInputProblem(`#${"あ".repeat(51)}`)).toMatch(/50 字まで/);
    expect(hashtagInputProblem("a b c d e f")).toMatch(/5 個まで/);
    expect(hashtagInputProblem("a b c d e")).toBeNull();
  });
  it("タグの行は # を付けて半角の空白でつなぐ", () => {
    expect(hashtagLine(["a", "b"])).toBe("#a #b");
  });
});

describe("字数とタグの数はタグ込みで数える", () => {
  it("Instagram は本文のタグと合わせて 5 個まで", () => {
    const text = withHashtags("新作です #映画", ["音楽", "サントラ", "邦画", "洋画", "Netflix"]);
    expect(countHashtags(text)).toBe(6);
    expect(checkTarget("instagram", text, { images: 1, videos: 0 }).issues).toContain("too_many_hashtags");
    expect(checkTarget("instagram", withHashtags("新作です", ["音楽", "サントラ", "邦画", "洋画", "Netflix"]), { images: 1, videos: 0 }).issues).not.toContain("too_many_hashtags");
  });
  it("X の字数はタグの行も数える", () => {
    const body = "あ".repeat(135);
    expect(checkTarget("x", body).issues).not.toContain("too_long");
    expect(checkTarget("x", withHashtags(body, ["個人開発"])).issues).toContain("too_long");
  });
});

describe("フォーマットのタグ", () => {
  it("SNS だけのタグがあればそれ、なければ全部の SNS のタグ", () => {
    const h = { all: ["個人開発"], instagram: ["映画", "音楽"] };
    expect(formatTagsFor(h, "x")).toEqual(["個人開発"]);
    expect(formatTagsFor(h, "threads")).toEqual(["個人開発"]);
    expect(formatTagsFor(h, "instagram")).toEqual(["映画", "音楽"]);
    expect(formatTagsFor({}, "x")).toEqual([]);
    expect(hasFormatHashtags(h)).toBe(true);
    expect(hasFormatHashtags({})).toBe(false);
  });
  it("編集の欄の文字を整えて持つ。空のキーは持たず、知らないキーは捨てる", () => {
    const p = formatInputSchema.parse({ name: "a", body: "b", hashtags: { all: "#個人開発 indiedev", x: " ", mastodon: "a" } });
    expect(p.hashtags).toEqual({ all: ["個人開発", "indiedev"] });
    expect(formatInputSchema.parse({ name: "a", body: "b" }).hashtags).toEqual({});
  });
  it("タグにできない言葉・6 個以上は、どの欄かを添えて断る", () => {
    const r = formatInputSchema.safeParse({ name: "a", body: "b", hashtags: { instagram: "a b c d e f" } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("Instagram のタグ: タグは 5 個までです");
  });
  it("DB から読んだ値は決まった形にそろえる", () => {
    expect(readFormatHashtags({ all: ["a", 1, ""], x: "b", mastodon: ["c"] })).toEqual({ all: ["a"] });
    expect(readFormatHashtags(null)).toEqual({});
    expect(readFormatHashtags(["a"])).toEqual({});
  });
});

describe("ステップの問題", () => {
  const issueLabel = () => "ハッシュタグが多すぎます";
  it("ハッシュタグが多すぎるのは、SNS ごとのタグがあれば ②、なければ ①", () => {
    expect(problemsByStep({ issues: [{ sns: "instagram", label: "Instagram", issues: ["too_many_hashtags"], override: false, tags: true, issueLabel }], noTargets: false, missingConnect: [], reconnect: [], needsTime: false })[0].step).toBe(2);
    expect(problemsByStep({ issues: [{ sns: "instagram", label: "Instagram", issues: ["too_many_hashtags"], override: false, tags: false, issueLabel }], noTargets: false, missingConnect: [], reconnect: [], needsTime: false })[0].step).toBe(1);
  });
  it("タグの欄の問題は ② で直す", () => {
    const p = problemsByStep({ issues: [], tagProblems: [{ label: "X", text: "タグは 5 個までです" }], noTargets: false, missingConnect: [], reconnect: [], needsTime: false });
    expect(p).toEqual([{ step: 2, text: "X: タグは 5 個までです" }]);
  });
});

describe("書きかけの控えとリセット", () => {
  const base = { body: "本文", overrides: {}, titles: {} };
  it("タグのない控えは、タグを足す前の版と同じ文字にする（前の控えを保存し直されたものと見なさない）", () => {
    expect(postDraftBase(base)).toBe(JSON.stringify({ body: "本文", overrides: {}, titles: {} }));
    expect(postDraftBase({ ...base, hashtags: { x: "" } })).toBe(postDraftBase(base));
    expect(postDraftBase({ ...base, hashtags: { x: "#a" } })).not.toBe(postDraftBase(base));
  });
  it("タグの欄を変えたら、控えと比べて違うものと見なす", () => {
    expect(samePostDraft({ ...base, hashtags: { x: "#a" } }, { ...base, hashtags: { x: "#a" } })).toBe(true);
    expect(samePostDraft({ ...base, hashtags: { x: "#a" } }, base)).toBe(false);
  });
  it("リセットで戻るものに SNS ごとのタグを出す", () => {
    const snap: ComposeSnapshot = { ...base, imageIds: [], plannedAt: "", targets: ["x", "instagram"], shortLinks: true, noteIds: [] };
    expect(composeChanges(snap, { ...snap, hashtags: { instagram: "#映画" } }, { saved: false })).toEqual(["SNS ごとのタグ（Instagram）"]);
    expect(composeChanges({ ...snap, hashtags: { x: "#a" } }, { ...snap, hashtags: { x: " #a " } }, { saved: true })).toEqual([]);
  });
});

describe("プライバシーポリシー（① の書き足し。docs/legal.md の 2026-11-12）", () => {
  const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
  it("投稿と投稿のフォーマットの行に、タグを書き足した", () => {
    expect(privacy).toContain("SNS ごとの文面、SNS ごとに付けるハッシュタグ（送るときに本文の後ろに付けます）");
    expect(privacy).toContain("つなげた投稿の柱の名前・毎回付けるハッシュタグ（全 SNS 共通と SNS ごと）");
  });
});
