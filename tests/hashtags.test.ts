// ハッシュタグ（設計のセクション、AI の案の整え方、下書きへの付け方、AI の見直しへの渡し方）。本物の API は呼ばない
import { describe, expect, it } from "vitest";
import { buildAiCheckRequest } from "@/lib/ai/ai-check";
import { tidyConsultDrafts } from "@/lib/ai/consult";
import { pickHashtags } from "@/lib/ai/plan-coach";
import { toSectionValue } from "@/lib/ai/plan-coach-schema";
import { buildPlanIdeasRequest, normalizeIdeas, POST_IDEAS_SYSTEM, type IdeaContext } from "@/lib/ai/post-ideas";
import { describeSection } from "@/lib/plan/describe";
import { isSectionDone, normalizePlan, parseSectionForm, sectionSchemas, type PlanData } from "@/lib/plan/schema";
import { checkTarget } from "@/lib/sns";
import { extractHashtags, HASHTAG_RULES, tidyDraftHashtags } from "@/lib/sns/hashtags";

function form(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const hashtags: PlanData["hashtags"] = {
  items: [
    { tag: "読書記録", why: "本の感想を投稿している人が見ている", when: "読んだ本の柱のとき" },
    { tag: "積読", why: "読みきれない本の話をする人", when: "積読の話のとき" },
  ],
};

describe("ハッシュタグ: 設計のセクション", () => {
  it("# / ＃ を外して持ち、空白や記号の入ったタグ・重なりは受け付けない", () => {
    expect(sectionSchemas.hashtags.parse({ items: [{ tag: " ＃読書記録 ", why: "", when: "" }] }).items[0].tag).toBe("読書記録");
    expect(sectionSchemas.hashtags.safeParse({ items: [{ tag: "拡散 希望" }] }).success).toBe(false);
    expect(sectionSchemas.hashtags.safeParse({ items: [{ tag: "読書。" }] }).success).toBe(false);
    expect(sectionSchemas.hashtags.safeParse({ items: [{ tag: "IndieDev" }, { tag: "#indiedev" }] }).error?.issues[0].message).toBe("同じハッシュタグが 2 つあります");
  });

  it("前の版の設計（ハッシュタグなし）は空として読み、タグが 1 つあれば済み", () => {
    const p = normalizePlan({ pillars: { items: [{ name: "a" }] } }, "");
    expect(p.hashtags).toEqual({ items: [] });
    expect(isSectionDone("hashtags", p.hashtags)).toBe(false);
    expect(isSectionDone("hashtags", hashtags)).toBe(true);
  });

  it("フォームはタグが空の行を捨て、理由と付けるときを残す", () => {
    const r = parseSectionForm("hashtags", form({ "hashtag-0-tag": "#読書記録", "hashtag-0-why": "本好き", "hashtag-1-why": "タグなし", "hashtag-2-tag": "積読", "hashtag-2-when": "積読の話" }));
    expect(r.success && r.data.items).toEqual([
      { tag: "読書記録", why: "本好き", when: "" },
      { tag: "積読", why: "", when: "積読の話" },
    ]);
    expect(parseSectionForm("hashtags", form({ "hashtag-0-tag": "読書 記録" })).error?.issues[0].message).toContain("空白や記号");
  });

  it("案の表示は、タグごとに理由と付けるときを出す", () => {
    expect(describeSection("hashtags", hashtags)[0]).toEqual({ label: "#読書記録", text: "本の感想を投稿している人が見ている\n付けるとき: 読んだ本の柱のとき" });
  });
});

describe("ハッシュタグ: AI の案", () => {
  it("案の中身は # を外し、使えない形と重なりを捨てる。全部だめなら使わない", () => {
    const v = toSectionValue("hashtags", { items: [{ tag: "#読書記録", why: "a", when: "" }, { tag: "読書記録", why: "b", when: "" }, { tag: "拡散 希望", why: "", when: "" }, { tag: "積読", why: "", when: "" }] });
    expect((v as PlanData["hashtags"]).items.map((i) => i.tag)).toEqual(["読書記録", "積読"]);
    expect(toSectionValue("hashtags", { items: [{ tag: "a b", why: "", when: "" }] })).toBeNull();
  });

  it("選んだ番号の候補だけを残す（範囲外・重なりは捨て、並びは案の順）", () => {
    expect(pickHashtags(hashtags, [1, 1, 5, -1])).toEqual({ value: { items: [hashtags.items[1]] }, picks: [1] });
    expect(pickHashtags(hashtags, [1, 0]).picks).toEqual([0, 1]);
  });
});

describe("ハッシュタグ: 下書きへの付け方", () => {
  it("SNS ごとの数の決まり（2026-10。Instagram は 5 個、Threads は 1 つ、X は 2 つまで）", () => {
    expect(HASHTAG_RULES.instagram.max).toBe(5);
    expect(HASHTAG_RULES.threads.max).toBe(1);
    expect(HASHTAG_RULES.x.max).toBe(2);
    const img = { images: 1, videos: 0, sizes: [{ width: 1080, height: 1080 }] };
    expect(checkTarget("instagram", "#a #b #c #d #e #f", img).issues).toContain("too_many_hashtags");
  });

  it("設計にないタグは、タグだけの行なら消し、文の途中なら # だけを外す", () => {
    expect(tidyDraftHashtags("読み終えました。\n\n#個人開発 #読書記録", ["読書記録"], "x")).toBe("読み終えました。\n\n#読書記録");
    expect(tidyDraftHashtags("#個人開発 でアプリを作っています", ["読書記録"], "x")).toBe("個人開発 でアプリを作っています");
    expect(tidyDraftHashtags("本文\n\n#個人開発", [], "x")).toBe("本文");
    expect(tidyDraftHashtags("issue#12 を直した", [], "x")).toBe("issue#12 を直した");
  });

  it("SNS の上限を超える分は、前から数えて外す（大文字・小文字は区別しない）", () => {
    expect(tidyDraftHashtags("本文 #読書記録 #積読", ["読書記録", "積読"], "threads")).toBe("本文 #読書記録 積読");
    expect(tidyDraftHashtags("本文\n#IndieDev #積読 #読書記録", ["indiedev", "積読", "読書記録"], "x")).toBe("本文\n#IndieDev #積読");
    expect(extractHashtags("本文 ＃読書記録 と #積読")).toEqual(["読書記録", "積読"]);
  });

  const ctx = (plan: PlanData): IdeaContext => ({ project: { name: "よみログ", description: "読書記録のアプリ", targetAudience: "本が好きな人" }, plan, sns: ["x", "threads"] });

  it("下書きを出す AI に、設計のタグと付けるとき・SNS ごとの数を渡す。決まっていなければ付けないと伝える", () => {
    const withTags = normalizePlan({ hashtags }, "本が好きな人");
    const text = (buildPlanIdeasRequest(ctx(withTags)).messages[0].content as { text: string }[])[0].text;
    expect(text).toContain("- #読書記録: 本の感想を投稿している人が見ている（付けるとき: 読んだ本の柱のとき）");
    expect(text).toContain("threads（Threads）: 500 字まで。話しかけるように。150〜300 字を目安に。ハッシュタグは 1 つまで");
    const none = (buildPlanIdeasRequest(ctx(normalizePlan({}, ""))).messages[0].content as { text: string }[])[0].text;
    expect(none).toContain("ハッシュタグ: まだ決まっていません（下書きにハッシュタグは付けない）");
    expect(POST_IDEAS_SYSTEM).toContain("どのネタ・どの下書きにも同じタグを決まりのように付けない");
    expect(POST_IDEAS_SYSTEM).not.toContain("ハッシュタグは 2 つまで、なくてもよい");
  });

  it("AI の下書きのタグは、設計のものだけ・SNS の上限までに整える", () => {
    const raw = {
      ideas: [{ pillar: "読んだ本", title: "今月の 1 冊", angle: "本好きに届く", commits: [], notes: [], drafts: [{ sns: "x", text: "読みました\n#個人開発 #読書記録" }, { sns: "threads", text: "読みました #読書記録 #積読" }] }],
      questions: [],
    };
    const r = normalizeIdeas(raw, { knownShas: [], sns: ["x", "threads"], hashtags: ["読書記録", "積読"] });
    expect(r!.ideas[0].drafts).toEqual([
      { sns: "x", text: "読みました\n#読書記録" },
      { sns: "threads", text: "読みました #読書記録 積読" },
    ]);
    // 設計でタグが決まっていなければ、付けない
    expect(normalizeIdeas(raw, { knownShas: [], sns: ["x"] })!.ideas[0].drafts[0].text).toBe("読みました");
  });

  it("相談の下書きの案も同じように整える（SNS を決めていない下書きは X の数で）", () => {
    const turn = {
      message: "案です",
      choices: [],
      proposal: {
        kind: "post_draft" as const,
        options: [{ kind: "post_draft" as const, sns: null, text: "本文\n#個人開発 #読書記録 #積読 #本", title: "a", summary: "", pros: [], cons: [] }],
        recommended: 0,
        reason: "",
      },
    };
    const out = tidyConsultDrafts(turn, ["読書記録", "積読", "本"]);
    expect((out.proposal!.options[0] as { text: string }).text).toBe("本文\n#読書記録 #積読");
  });
});

describe("ハッシュタグ: AI の見直し", () => {
  it("設計で決めたタグと付けるときを渡す。決まっていなければ未設定と伝える", () => {
    const text = (p: PlanData) => (buildAiCheckRequest({ projectName: "よみログ", plan: p }, [{ sns: "x", text: "本文" }]).messages[0].content as { text: string }[])[0].text;
    expect(text(normalizePlan({ hashtags }, ""))).toContain("ハッシュタグ（設計で決めたもの）: #読書記録（付けるとき: 読んだ本の柱のとき）、#積読（付けるとき: 積読の話のとき）");
    expect(text(normalizePlan({}, ""))).toContain("ハッシュタグ: （未設定）");
  });
});
