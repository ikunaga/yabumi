// 自動の回の送る前のチェックと、知らせの文（docs/design/auto-post.md の 2.5・2.7。src/lib/auto-post/checks.ts・engine.ts）
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { applyAiCheck, foreignLinks, jaccard, maxSimilarity, plainIssues, thresholdOf, trigrams, urlAllowed } from "@/lib/auto-post/checks";
import { generatedMessage } from "@/lib/auto-post/engine";

describe("重なり（3-gram の Jaccard）", () => {
  it("同じ文は 1、まったく違う文は 0。空白・全角半角・大文字小文字・タグ・URL は見ない", () => {
    const a = trigrams("冬の新メニュー、はじめました。 #パン https://example.com/a");
    expect(jaccard(a, trigrams("冬の新メニュー、はじめました。"))).toBe(1);
    expect(jaccard(trigrams("ＡＢＣ　ｄｅｆ"), trigrams("abcdef"))).toBe(1);
    expect(jaccard(trigrams("あいうえお"), trigrams("かきくけこ"))).toBe(0);
  });

  it("X は 0.5、ほかは 0.7 で「似すぎ」。少し言い換えただけの文は X で引っかかる", () => {
    expect(thresholdOf("x")).toBe(0.5);
    expect(thresholdOf("threads")).toBe(0.7);
    const before = "今週から冬の新メニューが始まりました。あたたかいスープと焼きたてのパンをどうぞ。";
    const after = "今週から冬の新メニューが始まりました。あたたかいスープと焼きたてのパンをぜひ。";
    expect(maxSimilarity(after, [before])).toBeGreaterThan(0.7);
    expect(maxSimilarity("春の花の写真を撮りに、近くの公園へ行ってきました。", [before])).toBeLessThan(0.2);
  });
});

describe("AI を呼ばないチェック", () => {
  const ok = { allowedUrls: ["https://shop.example.com/"], recent: {} };

  it("ふつうの文は通る。登録した行き先の URL は使える", () => {
    expect(plainIssues({ threads: "冬の新メニューを始めました。https://shop.example.com/menu" }, ok)).toEqual([]);
  });

  it("【】が残る・行き先にない URL・タグが多い・字数の上限・空の文・前の投稿と似すぎ", () => {
    expect(plainIssues({ threads: "【商品名】を始めました。" }, ok)[0].kind).toBe("made_up");
    expect(plainIssues({ threads: "こちら https://evil.example.org/ へ" }, ok)[0].kind).toBe("check_failed");
    expect(plainIssues({ threads: "パン #a #b" }, ok)[0].kind).toBe("check_failed");
    expect(plainIssues({ x: "あ".repeat(200) }, ok)[0].kind).toBe("too_long");
    expect(plainIssues({ threads: " " }, ok)[0].kind).toBe("cannot_write");
    const text = "今週から冬の新メニューが始まりました。あたたかいスープをどうぞ。";
    expect(plainIssues({ x: text }, { allowedUrls: [], recent: { x: [text] } })[0].kind).toBe("similar");
    // ほかの SNS に送った文とは比べない
    expect(plainIssues({ x: text }, { allowedUrls: [], recent: { threads: [text] } })).toEqual([]);
  });
});

describe("URL は登録した行き先の中だけ（前方一致ですり抜けない）", () => {
  const allowed = ["https://shop.example.com", "https://example.com/shop/"];
  it("同じオリジンで、行き先のパスの中なら通す", () => {
    expect(urlAllowed("https://shop.example.com/", allowed)).toBe(true);
    expect(urlAllowed("https://shop.example.com/menu?x=1", allowed)).toBe(true);
    expect(urlAllowed("https://example.com/shop/bread", allowed)).toBe(true);
  });
  it("ホストを伸ばした・ユーザー名を入れた・ポートやスキームを変えた・パスの外は通さない", () => {
    expect(urlAllowed("https://shop.example.com.evil.org/", allowed)).toBe(false);
    expect(urlAllowed("https://shop.example.com@evil.org/", allowed)).toBe(false);
    expect(urlAllowed("https://shop.example.com:8443/", allowed)).toBe(false);
    expect(urlAllowed("http://shop.example.com/", allowed)).toBe(false);
    expect(urlAllowed("https://example.com/shopping", allowed)).toBe(false);
    expect(urlAllowed("https://example.com/", allowed)).toBe(false);
  });
  it("スキームのないドメインも見る（X などはリンクにする）", () => {
    expect(foreignLinks("くわしくは evil.org/x へ", allowed)).toEqual(["evil.org/x"]);
    expect(foreignLinks("くわしくは shop.example.com へ", allowed)).toEqual([]);
    expect(foreignLinks("メールは a@b.example.jp まで。ver.2 になりました", allowed)).toEqual([]);
    expect(plainIssues({ threads: "こちら shop.example.com.evil.org です" }, { allowedUrls: allowed, recent: {} })[0].kind).toBe("check_failed");
  });
});

describe("AI っぽさチェックの結果の扱い（A2 の ②）", () => {
  const texts = { threads: "いかがでしたか？冬の新メニューです。", x: "いかがでしたか？冬の新メニューです。" };

  it("決まり文句・誇張などは直しを当てて通す（同じ文の SNS すべてに）", () => {
    const r = applyAiCheck(texts, { summary: "", findings: [{ sns: "threads", kind: "cliche", quote: "いかがでしたか？", why: "決まり文句", fix: "" }] });
    expect(r.hold).toBeNull();
    expect(r.fixed).toBe(1);
    expect(r.texts).toEqual({ threads: "冬の新メニューです。", x: "冬の新メニューです。" });
  });

  it("事実か確かめて（made_up）・やらないこと（avoid）は直さずに下書きへ", () => {
    expect(applyAiCheck(texts, { summary: "", findings: [{ sns: "x", kind: "made_up", quote: "冬", why: "本当ですか", fix: "" }] }).hold?.kind).toBe("made_up");
    expect(applyAiCheck(texts, { summary: "", findings: [{ sns: "x", kind: "avoid", quote: "冬", why: "やらないこと", fix: "" }] }).hold?.kind).toBe("avoid");
  });

  it("当てられない直しがあれば下書きへ", () => {
    expect(applyAiCheck(texts, { summary: "", findings: [{ sns: "x", kind: "tone", quote: "ない文", why: "口調", fix: "x" }] }).hold?.kind).toBe("check_failed");
  });
});

describe("知らせの文（本文は入れない。送り先の SNS と時刻だけ）", () => {
  const post = (sns: [string, string][]) => ({ post_targets: sns.map(([s, status]) => ({ sns: s, status })) });
  const due = "2026-11-17T10:00:00Z"; // 日本時間 11/17 19:00

  it("1 件: 予約・確かめが要る SNS・最初の回・下書き", () => {
    expect(generatedMessage([{ due_at: due, status: "scheduled", posts: post([["threads", "pending"]]) }]).body).toBe("11/17 19:00 に Threads に送ります");
    expect(generatedMessage([{ due_at: due, status: "scheduled", posts: post([["threads", "pending"], ["x", "awaiting_approval"]]) }]).body).toBe("11/17 19:00 に X・Threads に送ります（X は確かめが要ります）");
    expect(generatedMessage([{ due_at: due, status: "review", posts: post([["threads", "pending"]]) }]).title).toContain("最初の回");
    expect(generatedMessage([{ due_at: due, status: "held", posts: post([["threads", "pending"]]) }]).title).toContain("下書き");
  });

  it("2 件以上は 1 通にまとめる", () => {
    const m = generatedMessage([
      { due_at: due, status: "scheduled", posts: post([["x", "awaiting_approval"]]) },
      { due_at: due, status: "held", posts: post([["threads", "pending"]]) },
    ]);
    expect(m.body).toBe("2 件を作りました（確かめ待ち 1 件）（下書きに回した 1 件）");
  });
});
