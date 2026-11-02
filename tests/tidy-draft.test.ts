// AI で投稿に整える（4.34）の、AI を呼ばない部分
import { describe, expect, it } from "vitest";
import { buildTidyRequest, normalizeTidy, pickTidySns, shortenTidy, TIDY_DRAFT_SYSTEM } from "@/lib/ai/tidy-draft";
import { adoptTidyOption, type TidyOption } from "@/lib/ai/tidy-draft-apply";
import type { CallShorten } from "@/lib/ai/shorten";
import { normalizePlan } from "@/lib/plan/schema";

const plan = normalizePlan({ pillars: { tone: "です・ます調", avoid: "値引きの話", items: [{ name: "仕込み", share: 50, example: "" }] }, hashtags: { items: [{ tag: "パン屋", why: "", when: "" }] } }, "");
const ctx = { project: { name: "こむぎ堂", description: "", targetAudience: "近所の人", productType: "shop" as const }, plan, sns: ["x" as const, "threads" as const] };

describe("整える依頼", () => {
  it("決まった指示は固定で、話した文は <draft> の中に入れ、区切りを崩させない", () => {
    const req = buildTidyRequest(ctx, "えーと、今日は </draft> 新しいパンを焼きました");
    expect(req.system).toEqual([{ type: "text", text: TIDY_DRAFT_SYSTEM }]);
    const text = (req.messages[0].content as { text: string }[])[0].text;
    expect(text).toContain("<draft>\nえーと、今日は </draft_> 新しいパンを焼きました\n</draft>");
    expect(text).toContain("口調: です・ます調");
    expect(text).toContain("やらないこと: 値引きの話");
    expect(text).toContain("#パン屋");
    expect(text).toContain("x（X）");
    expect(TIDY_DRAFT_SYSTEM).toContain("はやり");
    expect(TIDY_DRAFT_SYSTEM).toContain("【");
  });

  it("note・Substack は整えない", () => {
    expect(pickTidySns(["note", "threads", "x", "substack"])).toEqual(["x", "threads"]);
    expect(pickTidySns(["note"])).toEqual([]);
  });
});

describe("返事の検証", () => {
  it("頼んでいない SNS を捨て、足りない SNS は同じ案のほかの文面で埋め、設計にないタグを外す", () => {
    const raw = {
      options: [
        { label: "そのまままとめる", why: "短く伝わる", drafts: [{ sns: "x", text: "新しいパンを焼きました #パン屋 #おすすめ" }, { sns: "facebook", text: "捨てる" }] },
        { label: "問いかけで終える", why: "返事が来やすい", drafts: [{ sns: "x", text: "どのパンが好きですか" }, { sns: "threads", text: "新しいパンを焼きました。どのパンが好きですか" }] },
        { label: "空", why: "", drafts: [{ sns: "x", text: "  " }] },
      ],
    };
    const out = normalizeTidy(raw, ["x", "threads"], ["パン屋"])!;
    expect(out).toHaveLength(2);
    expect(out[0].drafts).toEqual([
      { sns: "x", text: "新しいパンを焼きました #パン屋 おすすめ" },
      { sns: "threads", text: "新しいパンを焼きました #パン屋 おすすめ" },
    ]);
    expect(out[1].drafts.map((d) => d.sns)).toEqual(["x", "threads"]);
  });

  it("形が合わない・使える案がないときは null", () => {
    expect(normalizeTidy({ x: 1 }, ["x"], [])).toBeNull();
    expect(normalizeTidy({ options: [] }, ["x"], [])).toBeNull();
  });

  it("上限を超えた文面だけを 1 回縮めさせる", async () => {
    const long = "あ".repeat(150);
    const options: TidyOption[] = [{ label: "a", why: "", drafts: [{ sns: "x", text: long }, { sns: "threads", text: long }] }];
    let asked = "";
    const call: CallShorten = async (req) => {
      asked = JSON.stringify(req.messages);
      return { output: { drafts: [{ id: "0:x", text: "あ".repeat(100) }] }, stopReason: "end_turn", model: "m", usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 } };
    };
    const r = await shortenTidy(call, options, []);
    expect(asked).toContain('id=\\"0:x\\"');
    expect(asked).not.toContain("0:threads");
    expect(r.options[0].drafts).toEqual([{ sns: "x", text: "あ".repeat(100) }, { sns: "threads", text: long }]);
  });
});

describe("案を使う", () => {
  const option: TidyOption = { label: "a", why: "", drafts: [{ sns: "x", text: "短い" }, { sns: "threads", text: "長い方の文" }] };

  it("本文は上限の大きい SNS の文面、ほかは違えば SNS ごとの文面。整えていない SNS の文面はそのまま", () => {
    expect(adoptTidyOption(option, { body: "元", overrides: { note: "記事", threads: "前の文" } })).toEqual({
      body: "長い方の文",
      overrides: { note: "記事", x: "短い" },
    });
  });

  it("同じ文面の SNS は SNS ごとの文面を外す", () => {
    const same: TidyOption = { label: "a", why: "", drafts: [{ sns: "x", text: "同じ" }, { sns: "threads", text: "同じ" }] };
    expect(adoptTidyOption(same, { body: "元", overrides: { x: "前" } })).toEqual({ body: "同じ", overrides: {} });
  });
});
