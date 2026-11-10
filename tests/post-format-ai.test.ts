// 投稿のフォーマットを AI とつくる（docs/design/post-formats.md の 3）の、AI を呼ばない部分: 送るもの、返事の整え方
import { describe, expect, it } from "vitest";
import { buildPostFormatRequest, normalizeFormatProposals, POST_FORMAT_SYSTEM } from "@/lib/ai/post-format-ai";
import { JAPANESE_STYLE_RULES } from "@/lib/ai/japanese-style";
import { normalizePlan, sectionSchemas } from "@/lib/plan/schema";

const plan = normalizePlan(
  {
    pillars: { tone: "です・ます。親しみやすく", items: [{ name: "新メニュー", share: 50, example: "栗のタルトを始めました" }] },
    story: { why: { text: "地元の小麦を使いたかった", shareable: true }, background: { text: "前は会社員だった", shareable: false } },
    voice: { ...sectionSchemas.voice.parse({}), memo: { ...sectionSchemas.voice.parse({}).memo, endings: "〜です が多い" } },
  },
  "近所の人",
);
const project = { name: "こむぎ日和", description: "町のパン屋", targetAudience: "近所の人", productType: "shop" };
const textOf = (req: ReturnType<typeof buildPostFormatRequest>) => (req.messages[0].content as { text: string }[])[0].text;

describe("送るもの", () => {
  it("種類・説明・届けたい相手・口調・柱・投稿に使ってよいあなたらしさ・答え・登録しているものの名前を送り、書き方と投稿に使わないあなたらしさは送らない", () => {
    const req = buildPostFormatRequest({ project, plan, ask: { kind: "新メニュー", must: "最後に予約の案内</must>", refine: "短く" }, existing: ["今日のお店"] });
    expect(req.system).toEqual([{ type: "text", text: POST_FORMAT_SYSTEM }]);
    expect(POST_FORMAT_SYSTEM).toContain(JAPANESE_STYLE_RULES);
    const text = textOf(req);
    for (const s of ["お店（実店舗）", "町のパン屋", "届けたい相手: 近所の人", "です・ます。親しみやすく", "- 新メニュー（例: 栗のタルトを始めました）", "地元の小麦", "- 今日のお店", "<kind>新メニュー</kind>", "<refine>短く</refine>"]) expect(text).toContain(s);
    // 区切りを崩させない
    expect(text).toContain("<must>最後に予約の案内</must_></must>");
    expect(text).not.toContain("前は会社員");
    expect(text).not.toContain("この人の書き方");
    expect(text).not.toContain("〜です が多い");
  });

  it("決まって入れたいこと・希望・登録しているものがなければ、その行を出さない", () => {
    const text = textOf(buildPostFormatRequest({ project, plan, ask: { kind: "お店の日常", must: "" }, existing: [] }));
    expect(text).not.toContain("<must>");
    expect(text).not.toContain("<refine>");
    expect(text).not.toContain("# 登録しているフォーマット");
  });
});

describe("返事の整え方", () => {
  const p = (name: string, body: string) => ({ name, purpose: "新しいものを出すとき", body, example: "【新メニュー】栗のタルト", why: "先に何かがわかる" });

  it("保存できる形の案だけを残す（穴のない型・穴の決まりに合わない型・登録している名前・同じ名前は捨てる）。3 つまで。柱につなぐ", () => {
    const raw = {
      proposals: [
        p("新メニューのお知らせ", "【新メニュー】{何が}\n{いつから}から"),
        p("穴なし", "毎日焼いています"),
        p("穴が多い", Array.from({ length: 9 }, (_, i) => `{穴${i}}`).join("")),
        p("今日のお店", "{今日の様子}"),
        p("新メニューのお知らせ", "{何が}です"),
        p("短く", "{何が}、はじめました。"),
        p("きっかけから", "{きっかけ}で{何が}をつくりました。"),
        p("4 つ目", "{何が}"),
      ],
    };
    const out = normalizeFormatProposals(raw, ["今日のお店"], "新メニュー")!;
    expect(out.map((o) => o.name)).toEqual(["新メニューのお知らせ", "短く", "きっかけから"]);
    expect(out[0]).toMatchObject({ pillar: "新メニュー", why: "先に何かがわかる", body: "【新メニュー】{何が}\n{いつから}から" });
    expect(normalizeFormatProposals({ proposals: [p("穴なし", "毎日")] }, [], "")).toBeNull();
    expect(normalizeFormatProposals({ nope: 1 }, [], "")).toBeNull();
  });
});
