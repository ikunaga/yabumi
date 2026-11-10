// 投稿の文を書く AI に共通の「書く中身の決まり」（docs/architecture.md の 4.57）: 材料にない様子・気持ち・人の言葉・数字などを足さず、
// 要るところは【】で空ける決まりが、投稿の文を書く AI すべての指示（system）に入っていること。本物の AI は呼ばない
import { describe, expect, it } from "vitest";
import { AI_CHECK_SYSTEM, buildAiCheckRequest } from "@/lib/ai/ai-check";
import { APP_DESCRIPTION_SYSTEM } from "@/lib/ai/app-description";
import { CONTENT_RULES } from "@/lib/ai/content-rules";
import { CONSULT_SYSTEM } from "@/lib/ai/consult-prompt";
import { IMAGE_BRIEF_SYSTEM, buildImageBriefRequest } from "@/lib/ai/image-brief";
import { JAPANESE_STYLE_RULES, VOICE_HEADING } from "@/lib/ai/japanese-style";
import { PLAN_COACH_SYSTEM } from "@/lib/ai/plan-coach-prompt";
import { POST_FORMAT_SYSTEM } from "@/lib/ai/post-format-ai";
import { POST_IDEAS_SYSTEM, buildNewsIdeasRequest, type IdeaContext } from "@/lib/ai/post-ideas";
import { SHORTEN_SYSTEM, buildShortenRequest } from "@/lib/ai/shorten";
import { TIDY_DRAFT_SYSTEM, buildTidyRequest } from "@/lib/ai/tidy-draft";
import { VOICE_MEMO_SYSTEM } from "@/lib/ai/voice-memo";
import { normalizePlan } from "@/lib/plan/schema";

const SYSTEMS = { POST_IDEAS_SYSTEM, TIDY_DRAFT_SYSTEM, SHORTEN_SYSTEM, CONSULT_SYSTEM, AI_CHECK_SYSTEM, IMAGE_BRIEF_SYSTEM, APP_DESCRIPTION_SYSTEM, PLAN_COACH_SYSTEM, POST_FORMAT_SYSTEM };

const plan = normalizePlan({}, "近所に住む、パンが好きな人");
const ctx = { project: { name: "こむぎ日和", description: "天然酵母のパン屋", targetAudience: "近所に住む、パンが好きな人", productType: "shop" }, plan, sns: ["x"] } as unknown as IdeaContext;
const systemText = (req: { system: { text: string }[] }) => req.system.map((b) => b.text).join("\n");

describe("書く中身の決まり", () => {
  it("投稿の文を書く AI すべて（ネタ出し・整える・縮め直し・相談の下書き・見直し・画像の文字の案・自己紹介文・紹介文・投稿のフォーマットの案）の指示に入っている", () => {
    for (const [name, system] of Object.entries(SYSTEMS)) expect(system, name).toContain(CONTENT_RULES);
  });

  it("実際に送る指示（system）に入る。利用者のメッセージには入れない", () => {
    const reqs = {
      ideas: buildNewsIdeasRequest(ctx, [{ question: "最近やったことは？", answer: "金曜だけカンパーニュを焼き始めた" }]),
      tidy: buildTidyRequest(ctx, "金曜だけカンパーニュを焼くことにしました"),
      tidyFormat: buildTidyRequest(ctx, "", undefined, { name: "今週のパン", body: "今週は{何が}を焼きます。{いつ}に並びます。", values: { 何が: "カンパーニュ" } }),
      shorten: buildShortenRequest([{ id: "x", sns: "x", text: "金曜だけカンパーニュを焼きます。" }] as never),
      check: buildAiCheckRequest({ projectName: "こむぎ日和", plan }, [{ sns: "x", text: "金曜だけカンパーニュを焼きます。" }] as never),
      brief: buildImageBriefRequest({ projectName: "こむぎ日和", plan }, "金曜だけカンパーニュを焼きます。"),
    };
    for (const [name, req] of Object.entries(reqs)) {
      expect(systemText(req as never), name).toContain(CONTENT_RULES);
      expect(JSON.stringify(req.messages), name).not.toContain("書く中身の決まり");
    }
  });

  it("日本語の書き方の決まりより前に置き、どの書き方よりも先に守ると書く（日本語の決まりの優先の順と食い違わない）", () => {
    for (const [name, system] of Object.entries({ POST_IDEAS_SYSTEM, TIDY_DRAFT_SYSTEM, SHORTEN_SYSTEM, CONSULT_SYSTEM, AI_CHECK_SYSTEM, POST_FORMAT_SYSTEM })) {
      expect(system.indexOf(CONTENT_RULES), name).toBeLessThan(system.indexOf(JAPANESE_STYLE_RULES));
    }
    expect(CONTENT_RULES).toContain(`口調・「${VOICE_HEADING}」・日本語の書き方・整え方の希望よりも先に守る`);
    expect(JAPANESE_STYLE_RULES).toContain("書いていないことを足さない・誇張しない");
  });

  it("材料にない様子・人の言葉・気持ち・数字・日付・商品名・評判を足さず、要るところは【】で空ける", () => {
    for (const word of ["そのときの様子", "人の言葉や反応", "数字", "日付", "商品名", "実績や評判", "材料にない気持ち", "大きくしない", "架空の人の声", "【】で空けて"]) {
      expect(CONTENT_RULES, word).toContain(word);
    }
    // 書き方の例の投稿（実装担当2 の文調）は見本で、中身を今回の材料にしない
    expect(CONTENT_RULES).toContain(`「${VOICE_HEADING}」の例の投稿は書き方の見本で、そこに書かれたできごとや数字は今回の材料にしない`);
  });

  it("見直しは、AI が作り足しやすい様子・人の言葉・気持ち・評判を「事実か確かめて」で見落とさず、【】で空ける直しを出せる", () => {
    const madeUp = AI_CHECK_SYSTEM.split("\n").find((l) => l.startsWith("- made_up"))!;
    for (const word of ["そのときの様子", "人の言葉や反応", "気持ち", "実績や評判", "「」で書いた誰かの声", "【そのときの様子】"]) expect(madeUp, word).toContain(word);
  });

  it("投稿のフォーマット（実装担当2）と食い違わない: 型と穴の言葉は材料で、空の穴は【穴の名前】のまま。型の決まった言葉に事実を作らない", () => {
    expect(CONTENT_RULES).toContain("投稿のフォーマット（型と穴に入れた言葉）");
    expect(TIDY_DRAFT_SYSTEM).toContain("空の穴は【穴の名前】のまま残し、中身を作らない");
    const req = buildTidyRequest(ctx, "", undefined, { name: "今週のパン", body: "今週は{何が}を焼きます。{いつ}に並びます。", values: { 何が: "カンパーニュ" } });
    expect(JSON.stringify(req.messages)).toContain("【いつ】のまま残す");
    expect(POST_FORMAT_SYSTEM).toContain("穴の外の言葉は、その型で書くすべての投稿にそのまま入る。材料にない事実");
  });

  it("【】で空けられない文（画像の文字・紹介文・自己紹介文）では【】を使わず、書かないか質問する", () => {
    expect(CONTENT_RULES).toContain("【】を使わないと決めた文（画像の文字・紹介文・自己紹介文など）では、書かずにおくか、利用者に質問する");
    expect(IMAGE_BRIEF_SYSTEM).toContain("画像の文字には【】を使わない");
    expect(APP_DESCRIPTION_SYSTEM).toContain("紹介文には【】を使わず、わからないことは質問にする");
    expect(PLAN_COACH_SYSTEM).toContain("自己紹介文には【】を使わず、要るのに材料にないことは相手に聞く");
  });

  it("文調を読み取る AI（投稿を書かない）には入れない", () => {
    expect(VOICE_MEMO_SYSTEM).not.toContain(CONTENT_RULES);
  });
});
