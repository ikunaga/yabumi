// 宣伝するものの種類ごとの AI への手がかり（決定 D34）: 種類ごとの柱の例・質問・写真の例がそろうこと、
// 指示（system）から「個人開発者のアプリ」の決めつけが外れていること、種類で材料と「いまの状況」が切り替わること
import { describe, expect, it } from "vitest";
import { AI_CHECK_SYSTEM, checkContextText } from "@/lib/ai/ai-check";
import { CONSULT_SYSTEM, consultContextMessage, type ConsultContext } from "@/lib/ai/consult-prompt";
import { IMAGE_BRIEF_SYSTEM } from "@/lib/ai/image-brief";
import { PLAN_COACH_SYSTEM, coachContextMessage } from "@/lib/ai/plan-coach-prompt";
import { POST_IDEAS_SYSTEM, buildNewsIdeasRequest, ideaSourcesFor, newsQuestionsFor, type IdeaContext } from "@/lib/ai/post-ideas";
import { PLAN_EXAMPLES, PRODUCT_GUIDES, productLines, productTypeOf, usesDevTalk, usesStoreTalk } from "@/lib/ai/product-guide";
import { normalizePlan } from "@/lib/plan/schema";
import { describeSection } from "@/lib/plan/describe";
import { APP_DESCRIPTION_SYSTEM, FILE_PICK_SYSTEM } from "@/lib/ai/app-description";
import { glossary } from "@/lib/glossary/terms";
import { PRODUCT_TYPES, isDevProject } from "@/lib/projects/product-types";

describe("種類ごとの手がかり", () => {
  it("どの種類にも、投稿の柱の例・最近のできごとの 3 つの質問（答えの例つき）・写真の例がある", () => {
    for (const t of PRODUCT_TYPES) {
      const g = PRODUCT_GUIDES[t];
      expect(g.pillars.length).toBeGreaterThanOrEqual(3);
      expect(g.newsQuestions).toHaveLength(3);
      for (const q of g.newsQuestions) expect(q.choices.length).toBeGreaterThanOrEqual(2);
      expect(g.photo).not.toBe("");
    }
  });

  it("お店・教室・ネットショップ・作品の柱の例は、その仕事のもの（アプリは今のまま）", () => {
    expect(PRODUCT_GUIDES.shop.pillars).toEqual(expect.arrayContaining(["仕込み・準備のようす", "季節のおすすめ・新しいもの", "顧客の声", "店の裏側・人"]));
    expect(PRODUCT_GUIDES.service.pillars).toEqual(expect.arrayContaining(["顧客・生徒の変化", "よくある質問への答え", "先生・担当者の考え"]));
    expect(PRODUCT_GUIDES.online_shop.pillars).toEqual(expect.arrayContaining(["作る過程・材料", "使い方・合わせ方", "届いた人の声"]));
    expect(PRODUCT_GUIDES.creator.pillars).toEqual(expect.arrayContaining(["制作の過程", "作品に込めた考え", "見てくれた人の反応"]));
    expect(PRODUCT_GUIDES.app.pillars).toEqual(expect.arrayContaining(["詰まった・直したこと", "なぜそう作ったか", "アプリの小さな更新"]));
  });

  it("開発の話はアプリと Web のサービス、ストアの話はアプリだけ。種類が読めない（前の版のプロジェクト）ときはアプリとして扱う", () => {
    expect(PRODUCT_TYPES.filter(usesDevTalk)).toEqual(["app", "web_service"]);
    expect(PRODUCT_TYPES.filter(usesStoreTalk)).toEqual(["app"]);
    expect(PRODUCT_TYPES.filter((t) => isDevProject({ product_type: t }))).toEqual(["app", "web_service"]);
    expect(isDevProject({ product_type: null })).toBe(true);
    expect(productLines({ productType: "web_service", desiredAction: null }).join("\n")).toContain("ストア・ダウンロードの話は前提にしない");
    expect(productTypeOf(undefined)).toBe("app");
    expect(productTypeOf("shop")).toBe("shop");
    expect(productTypeOf("unknown")).toBe("app");
    expect(productLines({ productType: "shop", desiredAction: "visit" }).join("\n")).toContain("アプリではないので、開発・ストア・ダウンロードの話を前提にしない");
    expect(productLines({ productType: "app", desiredAction: null }).join("\n")).toContain("見た人にしてほしいこと: まだ決めていない");
  });
});

describe("指示から「個人開発者のアプリ」の決めつけを外す", () => {
  it("どの指示も、宣伝したい商品・サービスがある人に向けた書き方で、Build in Public を前提にしない", () => {
    for (const sys of [PLAN_COACH_SYSTEM, POST_IDEAS_SYSTEM, CONSULT_SYSTEM, IMAGE_BRIEF_SYSTEM, AI_CHECK_SYSTEM]) {
      expect(sys).toContain("宣伝したい商品・サービス");
      expect(sys).not.toContain("個人開発者の");
      expect(sys).not.toContain("Build in Public");
    }
  });
});

describe("ネタを出す", () => {
  it("材料の並びは「最近のできごと」が先頭、「その他」がいちばん下。「最近の開発から（GitHub）」はアプリと Web のサービスのときだけ", () => {
    expect(ideaSourcesFor("shop")).toEqual(["news", "notes", "plan", "x_post", "other"]);
    expect(ideaSourcesFor("creator")).not.toContain("commits");
    expect(ideaSourcesFor("app")).toEqual(["news", "notes", "plan", "commits", "x_post", "other"]);
    expect(ideaSourcesFor("web_service")).toEqual(["news", "notes", "plan", "commits", "x_post", "other"]);
  });

  it("最近のできごとの 3 つの質問は種類ごと", () => {
    expect(newsQuestionsFor("shop")[0].question).toContain("お店");
    expect(newsQuestionsFor("service")[0].question).toContain("生徒さん");
    expect(newsQuestionsFor("app")[0].question).toContain("アプリ");
  });

  it("AI に渡すプロジェクトに、種類・してほしいこと・種類ごとの柱の例を入れる", () => {
    const ctx: IdeaContext = {
      project: { name: "喫茶ひより", description: "駅前の小さな喫茶店", targetAudience: "近くで働く人", productType: "shop" },
      plan: normalizePlan({ goal: { what: "", goalType: "visit", note: "" } }, ""),
      sns: ["instagram"],
    };
    const text = (buildNewsIdeasRequest(ctx, [{ question: "新しく出したものは？", answer: "秋のケーキ" }]).messages[0].content as { text: string }[])[0].text;
    expect(text).toContain("宣伝するものの種類: お店（実店舗）（shop。");
    expect(text).toContain("見た人にしてほしいこと: 来てもらう（visit。");
    expect(text).toContain("仕込み・準備のようす");
    expect(text).toContain("アプリではないので");
  });
});

describe("アカウント設計・相談・見直しの「いまの状況」", () => {
  const plan = normalizePlan({}, "");
  it("アカウント設計: 種類とおすすめのしてほしいこと（先頭がいちばん）。アプリでなければストアのことを書かない", () => {
    const shop = coachContextMessage({ project: { name: "喫茶ひより", description: "", appStoreUrl: null, playStoreUrl: null, productType: "shop" }, plan, sources: {}, focus: null });
    expect(shop).toContain("この種類でおすすめのしてほしいこと（先頭がいちばん）: visit（来てもらう）、booking");
    expect(shop).not.toContain("ストアページ");
    const app = coachContextMessage({ project: { name: "かけいぼ", description: "", appStoreUrl: "https://apps.apple.com/x", playStoreUrl: null, productType: "app" }, plan, sources: {}, focus: null });
    expect(app).toContain("ストアページ: App Store あり / Google Play なし");
    expect(app).toContain("download（ダウンロードしてもらう）");
  });

  it("相談と見直しにも種類を渡す", () => {
    const ctx: ConsultContext = {
      today: "2026-11-02",
      project: { name: "ヨガ教室", description: "", appStoreUrl: null, playStoreUrl: null, productType: "service" },
      plan,
      connectedSns: [],
      manualSns: [],
      recentPosts: [],
      kpiNumbers: [],
      goals: { active: null, past: [], candidates: [] },
      roadmap: { items: [] },
    };
    expect(consultContextMessage(ctx)).toContain("宣伝するものの種類: サービス（教室・サロン・フリーランス）");
    // 振り返り: アプリでなければ、ストアの 3 つを「まだ数えていない」と渡さない（AI がストアをつなぐよう勧めないように）
    const review = { kpiValues: { link_clicks: { thisWeek: 4, lastWeek: 2 } }, clicksBySns: [], topClicked: [], topViewed: [] };
    const shopReview = consultContextMessage({ ...ctx, review });
    expect(shopReview).toContain("行き先へのクリック（link_clicks）: ");
    expect(shopReview).toContain("（outcomes）: まだ数えていない");
    for (const k of ["store_page_views", "downloads", "revenue"]) expect(shopReview).not.toContain(`（${k}）`);
    const appReview = consultContextMessage({ ...ctx, project: { ...ctx.project, productType: "app" }, review });
    for (const k of ["store_page_views", "downloads", "revenue"]) expect(appReview).toContain(`（${k}）: まだ数えていない`);
    expect(checkContextText({ projectName: "ヨガ教室", plan, productType: "service" })).toContain("顧客・生徒の変化");
  });
});

describe("アカウント設計の画面の記入例", () => {
  it("どの種類にも、相手・柱 4 本（割合の合計 100）・口調・ハッシュタグ・SNS ごとの役割・プロフィールの例がある", () => {
    for (const t of PRODUCT_TYPES) {
      const ex = PLAN_EXAMPLES[t];
      for (const v of [ex.who, ex.pain, ex.where, ex.ownershipReason, ex.tone, ex.avoid, ex.frequency, ex.hashtag.tag, ex.hashtag.why, ex.hashtag.when, ex.profile.displayName, ex.profile.handle, ex.profile.bio, ex.profile.link]) expect(v).not.toBe("");
      expect(ex.pillars).toHaveLength(4);
      expect(ex.pillars.reduce((n, p) => n + Number(p.share), 0)).toBe(100);
      expect(Object.keys(ex.roles).sort()).toEqual(["facebook", "instagram", "note", "substack", "threads", "tiktok", "x", "youtube"]);
      // ハッシュタグの例は # なしで、空白や記号を入れない
      expect(ex.hashtag.tag).toMatch(/^[^\s#]+$/);
    }
  });

  it("アプリでない種類の例に、アプリ・ストア・開発の話を入れない", () => {
    for (const t of PRODUCT_TYPES.filter((t) => t !== "app" && t !== "web_service")) {
      expect(JSON.stringify(PLAN_EXAMPLES[t])).not.toMatch(/アプリ|App Store|ストア|開発/);
    }
    expect(PLAN_EXAMPLES.shop.pillars.map((p) => p.name)).toContain("仕込み・準備のようす");
  });
});


describe("汎用化の取りこぼし（文言）", () => {
  it("最初の 1 か月の記入例も種類ごと。アプリでなければストアの話をしない", () => {
    for (const t of PRODUCT_TYPES) {
      expect(PLAN_EXAMPLES[t].firstMonthGoal).not.toBe("");
      expect(PLAN_EXAMPLES[t].firstMonthMetrics).not.toBe("");
    }
    expect(PLAN_EXAMPLES.shop.firstMonthGoal).not.toMatch(/ストア/);
    expect(PLAN_EXAMPLES.app.firstMonthGoal).toContain("ストアページ");
  });

  it("アカウントの持ち方の「専用」は、アプリに限らない言い方", () => {
    expect(describeSection("ownership", { mode: "dedicated", reason: "" })).toEqual([{ label: "持ち方", text: "専用のアカウントを作る" }]);
  });

  it("GitHub の紹介文の指示は、開発しているもの（アプリ・Web のサービス）向けで、個人開発者に決めつけない", () => {
    for (const sys of [FILE_PICK_SYSTEM, APP_DESCRIPTION_SYSTEM]) {
      expect(sys).toContain("アプリや Web のサービス");
      expect(sys).not.toContain("個人開発者");
    }
  });

  it("キャンペーンリンクの用語は、ふつうのサイトの例を先に、App Store は「アプリなら」", () => {
    const t = glossary.campaignLink;
    expect(t.summary.indexOf("サイト")).toBeLessThan(t.summary.indexOf("App Store"));
    expect(t.summary).toContain("アプリなら");
  });
});
