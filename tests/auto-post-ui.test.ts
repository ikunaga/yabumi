import { describe, expect, it } from "vitest";
import { scheduleText } from "@/components/auto-post/format";
import { choiceKey, kindCards } from "@/components/auto-post/kind-picker";
import { projectNavItems, activeNavKey } from "@/components/nav/project-nav-items";
import { isReviewOnlySns, REVIEW_ONLY_SNS, REVIEW_REASON_DETAIL, REVIEW_REASON_SHORT } from "@/lib/auto-post/labels";
import { AUTO_SNS_STAGE_A, TARGET_MODES } from "@/lib/auto-post/types";
import { SNS_KEYS } from "@/lib/sns";

// 自動の投稿の画面（feat/auto-post-ui）の、画面の文とメニューの項目
describe("scheduleText", () => {
  const base = { time: "19:00", every_weeks: 1 as const, start: "2026-11-16" };
  it("曜日を ISO の順（月〜日）に並べる", () => {
    expect(scheduleText({ ...base, weekdays: [5, 2] })).toBe("週 2（火・金） 19:00");
  });
  it("7 日すべてで毎週なら「毎日」", () => {
    expect(scheduleText({ ...base, weekdays: [1, 2, 3, 4, 5, 6, 7], time: "12:00" })).toBe("毎日 12:00");
  });
  it("2 週ごと以上は間隔を書く（7 日でも毎日とは言わない）", () => {
    expect(scheduleText({ ...base, weekdays: [3], every_weeks: 2, time: "09:00" })).toBe("2 週ごと 1（水） 09:00");
    expect(scheduleText({ ...base, weekdays: [1, 2, 3, 4, 5, 6, 7], every_weeks: 2 })).toMatch(/^2 週ごと 7/);
  });
});

describe("メニューの「自動の投稿」", () => {
  it("「…」（その他）に出し、/auto 以下で選んでいる印を付ける", () => {
    const item = projectNavItems("p1").find((i) => i.key === "auto");
    expect(item).toMatchObject({ label: "自動の投稿", barLabel: "Autopilot", href: "/projects/p1/auto", main: false });
    expect(activeNavKey("auto")).toBe("auto");
  });
});

// 始める画面の「1 何を」のカード（2026-11-18 オーナーの了承した見本）
describe("「何を」のカード", () => {
  const empty = { seriesFormats: [], destinations: [], events: 0, pillarNames: [], unusedNotes: 0, unusedPhotoNotes: 0 };
  it("シリーズはフォーマットごとに 1 枚で、名前・投稿の例・これまでの回を出す", () => {
    const cards = kindCards(
      {
        ...empty,
        seriesFormats: [
          { id: "f1", name: "連想映画クイズ", example: "連想映画クイズ🎬\nデロリアン・雷\n\nこの映画は？", rounds: 3, hasImage: true, hasHeadline: true, imageSpec: "写真・縦 4:5・文字入り", fixedBody: false },
          { id: "f2", name: "今日の一枚", example: "", rounds: 0, hasImage: false, hasHeadline: false, imageSpec: null, fixedBody: false },
        ],
      },
      "p1",
      "/projects/p1/formats",
    );
    const series = cards.filter((c) => c.choice.kind === "series");
    expect(series.map((c) => [c.title, c.choice.formatId, c.off])).toEqual([
      ["連想映画クイズ", "f1", undefined],
      ["今日の一枚", "f2", undefined],
    ]);
    expect(series[0].example).toBe("連想映画クイズ🎬／デロリアン・雷／この映画は？");
    expect(series[0].count).toBe("これまで 3 回");
    expect(series[1].example).toBeUndefined();
    expect(new Set(cards.map((c) => c.key)).size).toBe(cards.length);
  });
  it("材料がなければ選べず、理由と直し方の行き先を出す。お知らせ・季節はいつも選べる", () => {
    const cards = kindCards(empty, "p1", "/projects/p1/formats");
    const off = Object.fromEntries(cards.map((c) => [c.key, c.off?.href ?? null]));
    expect(off).toEqual({
      "series:": "/projects/p1/formats",
      notes: "/projects/p1/notes",
      pillars: "/projects/p1/plan",
      events: null,
      product: "/projects/p1/edit",
    });
  });
  it("メモの数には、使い切ったときの動きを添える", () => {
    const notes = kindCards({ ...empty, unusedNotes: 2, unusedPhotoNotes: 1 }, "p1", "/f").find((c) => c.key === "notes")!;
    expect(notes.count).toBe("まだ使っていないメモ 2 件（写真つき 1）・使い切ったら自動の投稿は止まり、お知らせします");
  });
  it("選んだものの鍵は、シリーズだけフォーマットごとに分ける", () => {
    expect(choiceKey({ kind: "series", formatId: "f1" })).toBe("series:f1");
    expect(choiceKey({ kind: "notes" })).toBe("notes");
    expect(choiceKey(null)).toBe("");
  });
});

describe("「確かめて送る」だけの SNS の理由", () => {
  it("理由を出す SNS は、送り方が「確かめて送る」だけの SNS と同じ（DB の is_review_sns も X・TikTok・YouTube）", () => {
    for (const s of SNS_KEYS) expect(isReviewOnlySns(s), s).toBe(TARGET_MODES[s].length === 1 && TARGET_MODES[s][0] === "review");
    expect([...REVIEW_ONLY_SNS].sort()).toEqual(["tiktok", "x", "youtube"]);
  });
  it("どの SNS にも 1 行と「?」の説明がある", () => {
    for (const s of REVIEW_ONLY_SNS) {
      expect(REVIEW_REASON_SHORT[s].length).toBeGreaterThan(0);
      expect(REVIEW_REASON_DETAIL[s].length).toBeGreaterThan(REVIEW_REASON_SHORT[s].length);
    }
  });
  it("段階 A で選べないのは TikTok・YouTube（画面の「準備中」の行と合わせる）", () => {
    expect(SNS_KEYS.filter((s) => !AUTO_SNS_STAGE_A.includes(s)).sort()).toEqual(["tiktok", "youtube"]);
  });
});
