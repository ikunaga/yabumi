// 投稿をつくるの見え方を、実際に送る投稿にそろえる（2026-11-12 PMO の通しのテスト）: 短縮リンクの形と字数・アカウントの名前・X の画像の並び
import { describe, expect, it } from "vitest";
import { CODE_LENGTH, PLACEHOLDER_CODE, shortLinkShownText } from "@/lib/links/rules";
import { checkTarget } from "@/lib/sns";
import { MAX_TALL_RATIO, MAX_WIDE_RATIO, previewImageLayout, previewName } from "@/lib/sns/preview";

const LONG = "https://apps.apple.com/jp/app/ddy/id6759184065?l=en-US";
const BASE = "https://yabumi.app/go";
const text = `新しいアプリです。\n\n${LONG}\n\n#個人開発`;

describe("短縮リンクの見え方と字数", () => {
  it("保存する前は、同じドメイン・同じ長さの仮の短縮リンクにする", () => {
    const shown = shortLinkShownText(text, "threads", { enabled: true, base: BASE });
    expect(shown).toContain(`${BASE}/${PLACEHOLDER_CODE}`);
    expect(shown).not.toContain(LONG);
    expect(PLACEHOLDER_CODE).toHaveLength(CODE_LENGTH);
  });
  it("保存したあとは、本当の短縮リンク", () => {
    const shown = shortLinkShownText(text, "x", { enabled: true, base: BASE, saved: new Map([[LONG, `${BASE}/AbCd2345`]]) });
    expect(shown).toContain(`${BASE}/AbCd2345`);
  });
  it("字数は置き換えたあとの長さで数える（Threads は URL の字数をそのまま数える）", () => {
    const shown = shortLinkShownText(text, "threads", { enabled: true, base: BASE });
    expect(checkTarget("threads", shown, { images: 0, videos: 0 }).length).toBe(checkTarget("threads", text, { images: 0, videos: 0 }).length - LONG.length + `${BASE}/${PLACEHOLDER_CODE}`.length);
  });
  it("短縮リンクを使わない・Instagram・手で投稿する SNS は、そのまま", () => {
    expect(shortLinkShownText(text, "threads", { enabled: false, base: BASE })).toBe(text);
    expect(shortLinkShownText(text, "instagram", { enabled: true, base: BASE })).toBe(text);
    expect(shortLinkShownText(text, "note", { enabled: true, base: BASE })).toBe(text);
  });
  it("URL のあとの句読点は残す", () => {
    expect(shortLinkShownText(`こちら ${LONG}。`, "x", { enabled: true, base: BASE })).toBe(`こちら ${BASE}/${PLACEHOLDER_CODE}。`);
  });
});

describe("見え方の名前", () => {
  const account = { name: "ddy 〜Database Drift for You〜", handle: "scene_and_sound_jp" };
  it("X は表示名と @handle", () => {
    expect(previewName("x", "ddy", account)).toEqual({ name: account.name, handle: "scene_and_sound_jp" });
  });
  it("Threads・Instagram は handle", () => {
    expect(previewName("instagram", "ddy", account)).toEqual({ name: "scene_and_sound_jp", handle: null });
    expect(previewName("threads", "ddy", account)).toEqual({ name: "scene_and_sound_jp", handle: null });
  });
  it("つないでいなければプロジェクトの名前", () => {
    expect(previewName("instagram", "ddy", null)).toEqual({ name: "ddy", handle: null });
  });
});

describe("X の画像の並び（目安）", () => {
  it("1 枚の 4:5 は横長に切らず、3:4 までの縦長で出す", () => {
    expect(previewImageLayout([{ width: 1080, height: 1350 }]).ratio).toBeCloseTo(0.8);
    expect(previewImageLayout([{ width: 1000, height: 2000 }]).ratio).toBe(MAX_TALL_RATIO);
    expect(previewImageLayout([{ width: 3000, height: 1000 }]).ratio).toBe(MAX_WIDE_RATIO);
  });
  it("2 枚は左右、3 枚は左に 1 枚と右に 2 枚、4 枚は 2×2", () => {
    expect(previewImageLayout([{ width: 1, height: 1 }, { width: 1, height: 1 }])).toMatchObject({ cols: 2, rows: 1 });
    expect(previewImageLayout(Array(3).fill({ width: 1, height: 1 }))).toMatchObject({ cols: 2, rows: 2, tall: 0 });
    expect(previewImageLayout(Array(4).fill({ width: 1, height: 1 }))).toMatchObject({ cols: 2, rows: 2, tall: null });
  });
});
