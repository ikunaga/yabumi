// 投稿の文を書く AI の日本語の決まり（docs/architecture.md の 4.55）: 指示に決まりが入っていること、避けたい言い回しの確かめ、
// 引っかかった下書きだけを 1 回直させること、直しても残った言い回しを画面に出すこと。本物の AI は呼ばない
import { describe, expect, it } from "vitest";
import { AI_CHECK_SYSTEM } from "@/lib/ai/ai-check";
import { CONSULT_SYSTEM } from "@/lib/ai/consult-prompt";
import { shortenConsultDrafts } from "@/lib/ai/consult";
import type { ConsultTurn } from "@/lib/ai/consult-schema";
import { IMAGE_BRIEF_SYSTEM, normalizeImageBrief } from "@/lib/ai/image-brief";
import { HEADLINE_RULE, JAPANESE_STYLE_RULES, VOICE_HEADING, draftStyleChecker, emojiAllowed, styleProblems, stripHeadlineCommas } from "@/lib/ai/japanese-style";
import { PLAN_COACH_SYSTEM } from "@/lib/ai/plan-coach-prompt";
import { POST_IDEAS_SYSTEM, buildRefineIdeasRequest, ideasStyleChecker, shortenIdeas, type IdeaContext } from "@/lib/ai/post-ideas";
import { MAX_FIX_DRAFTS, SHORTEN_SYSTEM, buildShortenRequest, readShortened, shortenOverDrafts, type CallShorten } from "@/lib/ai/shorten";
import { DEFAULT_DIRECTION } from "@/lib/ai/tidy-direction";
import { TIDY_DRAFT_SYSTEM, shortenTidy, tidyStyleChecker } from "@/lib/ai/tidy-draft";
import { normalizePlan } from "@/lib/plan/schema";

const keys = (text: string, opts = {}) => styleProblems(text, opts).map((p) => p.key);

const NATURAL = "金曜の朝だけ、くるみとレーズンのカンパーニュを焼いています。噛むほど甘くて、軽くトーストすると香りが立ちます。";

describe("指示に日本語の決まりが入っている", () => {
  it("投稿の文を書く AI すべて（ネタ出し・整える・縮め直し・相談・見直し）に、同じ決まりを入れる", () => {
    for (const [name, system] of Object.entries({ POST_IDEAS_SYSTEM, TIDY_DRAFT_SYSTEM, SHORTEN_SYSTEM, CONSULT_SYSTEM, AI_CHECK_SYSTEM })) {
      expect(system, name).toContain(JAPANESE_STYLE_RULES);
    }
  });

  it("決まりに、優先の順（この人の書き方が先、中身の決まりはどの書き方でも）と、オーナーの指摘が入っている", () => {
    expect(JAPANESE_STYLE_RULES).toContain(`SNS ごとの口調 → 利用者のメッセージの「${VOICE_HEADING}」 → この決まり`);
    expect(VOICE_HEADING).toBe("# この人の書き方");
    expect(JAPANESE_STYLE_RULES).toContain("書いていないことを足さない・誇張しない・決まりきった型を使わない、はどの書き方でも守る");
    expect(JAPANESE_STYLE_RULES).toContain("見出し・キャッチコピー・画像の文字の見出しには読点（、）を入れない");
    expect(JAPANESE_STYLE_RULES).toContain("「顧客」と書かない");
    // 「〜」の決まりは入れない（「10 時〜」はふつうの日本語。PM の回答 2026-11-09）
    expect(JAPANESE_STYLE_RULES).not.toMatch(/「〜」で|波線/);
  });

  it("画像の文字の案と設計の相棒にも、見出しと自己紹介文・柱の例の決まりがある", () => {
    expect(IMAGE_BRIEF_SYSTEM).toContain(HEADLINE_RULE);
    expect(IMAGE_BRIEF_SYSTEM).toContain("「顧客」と書かない");
    expect(PLAN_COACH_SYSTEM).toContain("自己紹介文は、本人が書いたような落ち着いた文にする");
    expect(PLAN_COACH_SYSTEM).toContain("投稿の柱の例（example）は、どんな話題かがわかる短い 1 文にする");
  });

  it("AI くさい形に寄せていた指示を外した（整えるの「問いかけで終える」「最初の 1 行で引きつける」、1 文ごとの改行、Threads の「話しかけるように」）", () => {
    expect(TIDY_DRAFT_SYSTEM).not.toContain("最初の 1 行で引きつける");
    expect(TIDY_DRAFT_SYSTEM).not.toContain("意味のまとまりごとに改行する");
    expect(TIDY_DRAFT_SYSTEM).toContain("問いかけで終える形は、元の文が問いかけているか、整え方のねらいが「問いかけて反応をもらう」のときだけ");
    expect(POST_IDEAS_SYSTEM).not.toContain("問いかけなど");
    expect(POST_IDEAS_SYSTEM).toContain("例の文や言い回しはまねない");
  });
});

describe("避けたい言い回しの確かめ", () => {
  it("人が書いたような文は引っかけない", () => {
    expect(keys(NATURAL)).toEqual([]);
    expect(keys("来週から、火曜は定休日です。お間違えのないよう、お願いします。\n▶︎ ご予約はプロフィールのリンクから\n#カフェ #下北沢")).toEqual([]);
    expect(keys("通知の時間を選べるようにしました。朝に届くと続けやすい、という声をもらったからです。\n\n#個人開発")).toEqual([]);
  });

  it("感嘆符と問いかけ、呼びかけ、飾りの記号を数える", () => {
    expect(keys("新作です！ぜひ来てくださいね。")).toEqual([]);
    expect(keys("新作です！おいしいですよ！")).toContain("marks");
    expect(keys("朝のパン、好きですよね！")).toContain("calling");
    expect(keys("一緒に始めてみませんか？")).toContain("calling");
    expect(keys("今日も焼きました✨")).toContain("deco");
  });

  it("決まりきった型・カタカナ語・顧客を見つける", () => {
    const k = (t: string) => styleProblems(t).map((p) => p.label).join(" ");
    expect(k("パン好きな方へ\n金曜だけの新作を焼きました。")).toContain("「〜な人へ」の書き出し");
    expect(k("実は、金曜だけ焼いています。")).toContain("「実は」");
    expect(k("おいしく焼くポイントは3つあります。")).toContain("ポイントは〇つ");
    expect(k("いかがでしたか。")).toContain("いかがでしたか");
    expect(k("新しい焼き方をシェアします。")).toContain("シェアします");
    expect(keys("顧客の声を聞いて決めました。")).toContain("customer");
  });

  it("同じ語尾の連続・体言止めの重ね・「。」の混ざり・改行と箇条書き・読点の多い文", () => {
    expect(keys("新機能を足しました。不具合を直しました。画面を見直しました。")).toContain("same_ending");
    expect(keys("こだわりの一杯。金曜だけの新作。")).toContain("noun_ending");
    expect(keys("こだわりの一杯。焼き上がりは 9 時です。")).not.toContain("noun_ending");
    expect(keys("金曜に焼きます。\n朝 9 時から並びます")).toContain("period_mix");
    expect(keys("あ。\nい。\nう。\nえ。\nお。")).toContain("line_breaks");
    // X は 2 行まで
    expect(keys("金曜に焼きます。\n9 時からです。\n売り切れたら終わりです。", { sns: "x" })).toContain("line_breaks");
    expect(keys("金曜に焼きます。\n9 時からです。\n売り切れたら終わりです。", { sns: "threads" })).not.toContain("line_breaks");
    expect(keys("・朝 7 時から\n・予約はいりません")).toContain("bullets");
    expect(keys("朝は、早めに、店を開けて、焼きたてを、並べます。")).toContain("commas");
  });

  it("ハッシュタグの行とプロフィールのリンクの 1 行は数えない", () => {
    expect(keys("金曜に焼きます。\n▶︎ ご予約はプロフィールのリンクから\n#パン #カンパーニュ")).toEqual([]);
  });

  it("本人の文（整える元の文・例の投稿）にある言い回しは、本人の書き方として指摘しない。顧客だけは指摘する", () => {
    const own = "今日も焼けました！おいしいですよね！✨";
    const draft = "金曜も焼きます！楽しみですよね！✨";
    expect(keys(draft)).toEqual(expect.arrayContaining(["marks", "calling", "deco"]));
    expect(keys(draft, { allow: [own] })).toEqual([]);
    expect(keys("顧客に届けます。", { allow: ["顧客に届けます。"] })).toEqual(["customer"]);
  });

  it("問いかけを頼まれたときは問いを 1 つ許し、絵文字を使ってよい口調なら 2 つまで許す", () => {
    expect(keys("朝はパン派ですか？", { question: true })).toEqual([]);
    expect(keys("今日も焼きました🍞", { emoji: true })).toEqual([]);
    expect(keys("今日も焼きました🍞🥐🥖", { emoji: true })).toContain("deco");
    expect(emojiAllowed("です・ます。絵文字は 1 つまで")).toBe(true);
    expect(emojiAllowed("です・ます。絵文字は使わない")).toBe(false);
    expect(emojiAllowed("です・ます")).toBe(false);
    const check = draftStyleChecker({ tone: "です・ます", toneBySns: { instagram: "くだけた口調。絵文字は 1〜2 個" } });
    expect(check("instagram", "今日も焼きました🍞").map((p) => p.key)).toEqual([]);
    expect(check("x", "今日も焼きました🍞").map((p) => p.key)).toEqual([]);
    expect(check("x", "今日も焼きました✨").map((p) => p.key)).toEqual(["deco"]);
  });

  it("見出しの読点を外す", () => {
    expect(stripHeadlineCommas("金曜だけ、焼きます")).toBe("金曜だけ 焼きます");
    const brief = normalizeImageBrief({
      recommend: "card",
      reason: "1 つのことを伝える投稿なので",
      label: "新作、です",
      headlines: ["金曜だけ、焼くパン", "噛むほど甘い"],
      subline: "朝 9 時から、並べます",
      diagram: { title: "焼き方、3 つ", style: "points", items: [{ title: "粉、選び", text: "国産の粉を、使います" }] },
    });
    expect(brief?.headlines[0]).toBe("金曜だけ 焼くパン");
    expect(brief?.label).toBe("新作 です");
    expect(brief?.diagram.title).toBe("焼き方 3 つ");
    expect(brief?.diagram.items[0].title).toBe("粉 選び");
    // 補足と説明の文は文なので、読点はそのまま
    expect(brief?.subline).toBe("朝 9 時から、並べます");
  });
});

// 縮め直しの AI の代わり（頼まれた下書きを、決めた文で返す）
function fakeShorten(replies: Record<string, string>, calls: string[][] = []): CallShorten {
  return async (req) => {
    const text = (req.messages[0].content as { text: string }[])[0].text;
    const ids = [...text.matchAll(/<draft id="([^"]+)"/g)].map((m) => m[1]);
    calls.push(ids);
    return {
      output: { drafts: ids.filter((id) => replies[id] !== undefined).map((id) => ({ id, text: replies[id] })) },
      stopReason: "end_turn",
      model: "fake",
      usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
    };
  };
}

const check = (d: { sns: string }, t: string) => styleProblems(t, { sns: d.sns });

describe("引っかかった下書きだけを 1 回直させる（縮め直しと同じ呼び出し）", () => {
  it("言い回しが引っかかった下書きだけを送り、直すところを伝える。引っかからなければ呼ばない", async () => {
    const calls: string[][] = [];
    const drafts = [
      { id: "a", sns: "threads" as const, text: NATURAL },
      { id: "b", sns: "threads" as const, text: "新作です！おいしいですよね！" },
    ];
    const { texts } = await shortenOverDrafts(fakeShorten({ b: "新作のカンパーニュを焼きました。噛むほど甘いパンです。" }, calls), drafts, check);
    expect(calls).toEqual([["b"]]);
    expect(texts.get("b")).toBe("新作のカンパーニュを焼きました。噛むほど甘いパンです。");
    const req = buildShortenRequest([drafts[1]], new Map([["b", styleProblems(drafts[1].text)]]));
    const body = (req.messages[0].content as { text: string }[])[0].text;
    expect(body).toContain("直すところ: 「！」「？」が 2 つあります");
    expect(body).not.toContain("縮めて:");

    const none: string[][] = [];
    await shortenOverDrafts(fakeShorten({}, none), [drafts[0]], check);
    expect(none).toEqual([]);
  });

  it("直した文が前より悪い・変わらない・上限を超えるときは使わない", () => {
    const src = [{ id: "b", sns: "x" as const, text: "新作です！おいしいですよね！" }];
    const reply = (text: string) => ({ drafts: [{ id: "b", text }] });
    expect(readShortened(reply("新作です！おいしいですよね！✨"), src, check).size).toBe(0);
    expect(readShortened(reply("新作です！おいしいですよね！"), src, check).size).toBe(0);
    expect(readShortened(reply("あ".repeat(200)), src, check).size).toBe(0);
    expect(readShortened(reply("新作を焼きました。"), src, check).get("b")).toBe("新作を焼きました。");
  });

  it("1 回で直すのは 8 本まで（上限を超えたものを先に）", async () => {
    const calls: string[][] = [];
    const drafts = Array.from({ length: 12 }, (_, i) => ({ id: String(i), sns: "threads" as const, text: i === 11 ? "あ".repeat(600) : "新作です！おいしいですよね！" }));
    await shortenOverDrafts(fakeShorten({}, calls), drafts, check);
    expect(calls[0]).toHaveLength(MAX_FIX_DRAFTS);
    expect(calls[0]).toContain("11");
  });

  it("ネタ出し: 直した文を入れ、直しても残った言い回しを style に入れる。出し直しの AI には style を渡さない", async () => {
    const ctx: IdeaContext = { project: { name: "こむぎ日和", description: "", targetAudience: "", productType: "shop" }, plan: normalizePlan({}, ""), sns: ["x", "threads"] };
    const value = {
      ideas: [
        {
          pillar: "仕込み",
          title: "金曜のパン",
          angle: "",
          commits: [],
          notes: [],
          drafts: [
            { sns: "x" as const, text: "金曜だけ焼きます！楽しみですよね！" },
            { sns: "threads" as const, text: "実は、金曜だけの新作があります。" },
          ],
        },
      ],
      questions: [],
    };
    const call = fakeShorten({ "0:x": "金曜だけ焼くパンがあります。", "0:threads": "実は、金曜だけの新作があります。" });
    const { value: out } = await shortenIdeas(call, value, [], ideasStyleChecker(ctx, {}));
    expect(out.ideas[0].drafts[0]).toEqual({ sns: "x", text: "金曜だけ焼くパンがあります。" });
    // threads は直らなかった（同じ文が返った）ので、残った言い回しを出す
    expect(out.ideas[0].drafts[1].style?.join("")).toContain("「実は」");
    const refine = buildRefineIdeasRequest(ctx, { kind: "ideas", ...out, adopted: {} }, [{ question: "q", answer: "a" }]);
    expect((refine.messages[0].content as { text: string }[])[0].text).not.toContain("style");
  });

  it("ネタ出し: 本人が書いた最近のできごとにある言い回しは指摘しない", () => {
    const ctx: IdeaContext = { project: { name: "x", description: "", targetAudience: "", productType: "shop" }, plan: normalizePlan({}, ""), sns: ["x"] };
    const c = ideasStyleChecker(ctx, { news: [{ question: "q", answer: "今日も焼けました！おいしいですよね！" }] });
    expect(c("x", "金曜も焼けました！楽しみですよね！")).toEqual([]);
  });

  it("整える: 元の文の言い回しは指摘せず、整え方の問いかけ・絵文字に合わせる。直しても残れば style に入れる", async () => {
    const ctx: IdeaContext = { project: { name: "x", description: "", targetAudience: "", productType: "shop" }, plan: normalizePlan({}, ""), sns: ["threads"] };
    const q = tidyStyleChecker(ctx, "金曜に焼きます", { ...DEFAULT_DIRECTION, aim: "question" });
    expect(q("threads", "金曜に焼きます。一緒に食べませんか？")).toEqual([]);
    const plain = tidyStyleChecker(ctx, "金曜に焼きます");
    expect(plain("threads", "金曜に焼きます。一緒に食べませんか？").map((p) => p.key)).toEqual(["calling"]);
    // 元の文が問いかけていれば、本人の書き方として指摘しない
    expect(tidyStyleChecker(ctx, "金曜に焼くけど一緒に食べませんか？")("threads", "金曜に焼きます。一緒に食べませんか？")).toEqual([]);
    const options = [{ label: "そのまままとめる", why: "", drafts: [{ sns: "threads" as const, text: "金曜に焼きます✨" }] }];
    const { options: out } = await shortenTidy(fakeShorten({}), options, [], null, plain);
    expect(out[0].drafts[0].style?.join("")).toContain("飾りの記号");
  });

  it("相談: SNS を決めた下書きは直させ、決めていない下書きは残った言い回しだけを出す", async () => {
    const turn = {
      message: "案です",
      choices: [],
      proposal: {
        kind: "post_draft",
        title: "下書き",
        options: [
          { kind: "post_draft", sns: "x", text: "新作です！おいしいですよね！", title: "a", pros: "", cons: "" },
          { kind: "post_draft", sns: null, text: "今日も焼きました✨", title: "b", pros: "", cons: "" },
        ],
      },
    } as unknown as ConsultTurn;
    const calls: string[][] = [];
    const { turn: out } = await shortenConsultDrafts(fakeShorten({ "0": "新作を焼きました。" }, calls), turn, (sns, t) => styleProblems(t, { sns }));
    expect(calls).toEqual([["0"]]);
    const opts = out.proposal!.options as { text: string; style?: string[] }[];
    expect(opts[0]).toMatchObject({ text: "新作を焼きました。" });
    expect(opts[0].style).toBeUndefined();
    expect(opts[1].style?.join("")).toContain("飾りの記号");
  });
});
