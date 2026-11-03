// 投稿の柱を SNS ごとに使い分ける（src/lib/plan/pillars.ts）: 前の形の読み替え、SNS ごとの割合、AI の材料の切り替え。本物の AI は呼ばない
import { describe, expect, it } from "vitest";
import { buildAiCheckRequest, checkContextText } from "@/lib/ai/ai-check";
import { buildImageBriefRequest } from "@/lib/ai/image-brief";
import { buildPhotoIdeasRequest } from "@/lib/ai/photo";
import { toSectionValue } from "@/lib/ai/plan-coach-schema";
import { ideaContextText, normalizeIdeas, type IdeaContext } from "@/lib/ai/post-ideas";
import { describeSection } from "@/lib/plan/describe";
import { ideaPillarAllows, isSplitBySns, pillarPromptLines, pillarsBySns, pillarsFor, pillarViewSns } from "@/lib/plan/pillars";
import { normalizePlan, parseSectionForm, sectionSchemas } from "@/lib/plan/schema";

const split = normalizePlan(
  {
    pillars: {
      items: [
        { name: "開発の状況", share: 50, example: "今週直したこと", sns: ["x", "threads"] },
        { name: "エンジニアとしての生き方", share: 50, example: "", sns: ["threads", "x"] },
        { name: "映画の紹介", share: 60, example: "", sns: ["instagram"] },
        { name: "音楽の紹介", share: 40, example: "", sns: ["instagram"] },
      ],
      tone: "です・ます調",
      avoid: "",
    },
  },
  "",
);
const items = split.pillars.items;

describe("前の形の読み替え", () => {
  it("sns のない柱（前の版）は「すべての SNS」として読み、セクションは空にならない", () => {
    const plan = normalizePlan({ pillars: { items: [{ name: "詰まった・直した", share: 40, example: "" }], tone: "", avoid: "" } }, "");
    expect(plan.pillars.items).toEqual([{ name: "詰まった・直した", share: 40, example: "", sns: [] }]);
    expect(isSplitBySns(plan.pillars.items)).toBe(false);
    expect(pillarsFor(plan.pillars.items, "instagram").map((p) => p.name)).toEqual(["詰まった・直した"]);
  });

  it("知らない SNS は捨て、並びは SNS の順にそろえる（ほかの柱は残る）", () => {
    const v = sectionSchemas.pillars.parse({ items: [{ name: "a", share: null, example: "", sns: ["instagram", "mastodon", "x"] }] });
    expect(v.items[0].sns).toEqual(["x", "instagram"]);
    expect(items[1].sns).toEqual(["x", "threads"]);
  });

  it("フォームのチップ（pillar-<n>-sns）を読む。選ばなければすべて", () => {
    const f = new FormData();
    f.set("pillar-0-name", "開発");
    f.set("pillar-0-share", "50");
    f.append("pillar-0-sns", "threads");
    f.append("pillar-0-sns", "x");
    f.set("pillar-1-name", "映画");
    const r = parseSectionForm("pillars", f);
    expect(r.success).toBe(true);
    expect(r.data!.items.map((i) => i.sns)).toEqual([["x", "threads"], []]);
  });

  it("フォームで知らない SNS を送っても、捨てて保存する", () => {
    const f = new FormData();
    f.set("pillar-0-name", "開発");
    f.append("pillar-0-sns", "bogus");
    expect(parseSectionForm("pillars", f).data!.items[0].sns).toEqual([]);
  });

  it("AI の案（plan-coach・相談）の sns も読む。sns のない前の案はすべて", () => {
    const v = toSectionValue("pillars", {
      items: [
        { name: "開発", share: 50, example: "", sns: ["x", "mastodon"] },
        { name: "映画", share: 60, example: "" },
      ],
      tone: "",
      avoid: "",
    }) as typeof split.pillars;
    expect(v.items.map((i) => i.sns)).toEqual([["x"], []]);
  });
});

describe("SNS ごとの割合", () => {
  it("その SNS に付いた柱の中で数える", () => {
    const r = pillarsBySns(items, ["x", "instagram", "facebook"]);
    expect(r.map((x) => [x.sns, x.pillars.map((p) => p.name), x.total])).toEqual([
      ["x", ["開発の状況", "エンジニアとしての生き方"], 100],
      ["instagram", ["映画の紹介", "音楽の紹介"], 100],
      ["facebook", [], 0],
    ]);
  });

  it("すべての SNS の柱は、どの SNS の合計にも入る", () => {
    const mixed = [...items, { name: "お知らせ", share: 10, example: "", sns: [] }];
    expect(pillarsBySns(mixed, ["x", "instagram"]).map((x) => x.total)).toEqual([110, 110]);
  });

  it("まとめて見る SNS は、使っている SNS と柱で選んだ SNS（SNS の順）", () => {
    expect(pillarViewSns(items, ["facebook"])).toEqual(["x", "threads", "instagram", "facebook"]);
  });

  it("設計の案の表示に、柱ごとの SNS を添える（分けていなければ添えない）", () => {
    const rows = describeSection("pillars", split.pillars);
    expect(rows[0].text).toContain("・映画の紹介（60%）［Instagram］");
    expect(rows[0].text).toContain("・開発の状況（50%）［X・Threads］");
    const plain = describeSection("pillars", normalizePlan({ pillars: { items: [{ name: "a", share: 10, example: "" }] } }, "").pillars);
    expect(plain[0].text).toBe("・a（10%）");
  });
});

describe("AI の材料の切り替え", () => {
  it("分けていなければ、前と同じ 1 つの一覧", () => {
    const plan = normalizePlan({ pillars: { items: [{ name: "詰まった・直した", share: 40, example: "" }] } }, "");
    expect(pillarPromptLines(plan.pillars.items, ["x"])).toEqual(["- 柱「詰まった・直した」（40%）"]);
    expect(pillarPromptLines([], ["x"])).toEqual(["投稿の柱はまだ決まっていません。"]);
  });

  it("送り先の SNS に付いた柱だけを、SNS ごとに出す", () => {
    const text = pillarPromptLines(items, ["instagram"]).join("\n");
    expect(text).toContain("Instagram（instagram）の柱:");
    expect(text).toContain("映画の紹介");
    expect(text).not.toContain("開発の状況");
    expect(text).not.toContain("X（x）");
  });

  it("送り先がわからなければ、すべての柱に使う SNS を添える", () => {
    const text = pillarPromptLines(items, []).join("\n");
    expect(text).toContain("柱「映画の紹介」（60%）（使う SNS: Instagram）");
    expect(text).toContain("（使う SNS: X・Threads）");
  });

  it("その SNS に付いた柱がなければ、そう書く", () => {
    expect(pillarPromptLines(items, ["facebook"]).join("\n")).toContain("この SNS に付いた柱はありません");
  });

  const ctx = (sns: IdeaContext["sns"]): IdeaContext => ({
    project: { name: "yabumi", description: "", targetAudience: "", productType: "app" },
    plan: split,
    sns,
  });

  it("ネタを出す・AI で投稿に整える（ideaContextText）は、送り先の SNS の柱だけ", () => {
    const x = ideaContextText(ctx(["x"]));
    expect(x).toContain("開発の状況");
    expect(x).not.toContain("映画の紹介");
    const both = ideaContextText(ctx(["x", "instagram"]));
    expect(both).toContain("X（x）の柱:");
    expect(both).toContain("Instagram（instagram）の柱:");
  });

  it("ネタの柱が付いていない SNS の下書きは捨てる。設計にない柱の名前はどの SNS にも残す", () => {
    const raw = {
      ideas: [
        { pillar: "映画の紹介", title: "今週見た映画", angle: "", commits: [], notes: [], drafts: [{ sns: "x", text: "X の文" }, { sns: "instagram", text: "IG の文" }] },
        { pillar: "開発の状況", title: "直したこと", angle: "", commits: [], notes: [], drafts: [{ sns: "instagram", text: "IG の文" }] },
        { pillar: "なぜ作ったか", title: "始めた理由", angle: "", commits: [], notes: [], drafts: [{ sns: "x", text: "X の文" }, { sns: "instagram", text: "IG の文" }] },
      ],
      questions: [],
    };
    const r = normalizeIdeas(raw, { knownShas: [], sns: ["x", "instagram"], pillars: items })!;
    expect(r.ideas.map((i) => [i.title, i.drafts.map((d) => d.sns)])).toEqual([
      ["今週見た映画", ["instagram"]],
      ["始めた理由", ["x", "instagram"]],
    ]);
    expect(ideaPillarAllows(items, " 映画の紹介 ", "x")).toBe(false);
    // 柱を渡さなければ、前と同じ（どの SNS も残す）
    expect(normalizeIdeas(raw, { knownShas: [], sns: ["x", "instagram"] })!.ideas[0].drafts).toHaveLength(2);
  });

  it("AI の見直しは、確かめる投稿の SNS の柱だけ", () => {
    const req = buildAiCheckRequest({ projectName: "yabumi", plan: split, sns: ["instagram"] }, [{ sns: "instagram", text: "映画を見ました" }]);
    const text = (req.messages[0].content as { text: string }[])[0].text;
    expect(text).toContain("映画の紹介");
    expect(text).not.toContain("開発の状況");
    // 柱がなければ柱の行を出さない（前と同じ）
    expect(checkContextText({ projectName: "p", plan: normalizePlan(null, "") })).not.toContain("投稿の柱は");
  });

  it("画像の案・絵の説明の案も、送り先の SNS の柱だけ", () => {
    const photo = (buildPhotoIdeasRequest({ projectName: "yabumi", plan: split, sns: ["x"] }, "本文").messages[0].content as { text: string }[])[0].text;
    expect(photo).toContain("開発の状況");
    expect(photo).not.toContain("映画の紹介");
    const brief = (buildImageBriefRequest({ projectName: "yabumi", plan: split, sns: ["instagram"] }, "本文").messages[0].content as { text: string }[])[0].text;
    expect(brief).toContain("映画の紹介");
    expect(brief).not.toContain("開発の状況");
  });
});
