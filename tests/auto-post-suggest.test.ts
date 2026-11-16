import { describe, expect, it } from "vitest";
import { parseFrequency, suggestKind, suggestSchedules, suggestTime, type SuggestMaterials } from "@/lib/auto-post/suggest";
import type { TimeTrends } from "@/lib/metrics/time-bands";
import { scheduleSchema } from "@/lib/auto-post/schema";

const none: SuggestMaterials = { unusedNotes: 0, unusedPhotoNotes: 0, seriesFormats: 0, destinations: 0 };
const noTrend: TimeTrends = { views: { ready: false, need: 3 }, clicks: { ready: false, need: 5 } };
const nightViews: TimeTrends = {
  views: { ready: true, best: "night", bands: [{ band: "night", value: 400, count: 6 }, { band: "noon", value: 120, count: 5 }] },
  clicks: { ready: false, need: 2 },
};
const eveningClicks: TimeTrends = {
  views: { ready: false, need: 1 },
  clicks: { ready: true, best: "evening", bands: [{ band: "evening", value: 9, count: 9 }, { band: "morning", value: 5, count: 5 }] },
};

describe("何を: 使い道のおすすめ（2.6）", () => {
  it("使っていないメモが 6 件以上ならネタ帳から（写真つきの数も添える）", () => {
    const s = suggestKind({ ...none, unusedNotes: 12, unusedPhotoNotes: 5, seriesFormats: 1, destinations: 3 });
    expect(s.kind).toBe("notes");
    expect(s.reason).toBe("使っていないメモが 12 件。写真つきは 5 件");
    expect(suggestKind({ ...none, unusedNotes: 6 }).reason).toBe("使っていないメモが 6 件");
  });

  it("メモが 5 件以下なら、シリーズ → 商品の紹介 → 柱の順", () => {
    expect(suggestKind({ ...none, unusedNotes: 5, seriesFormats: 2, destinations: 1 }).kind).toBe("series");
    expect(suggestKind({ ...none, unusedNotes: 5, destinations: 1 }).kind).toBe("product");
    expect(suggestKind({ ...none, unusedNotes: 5 }).kind).toBe("pillars");
    expect(suggestKind(none).kind).toBe("pillars");
  });

  it("お知らせ・季節など、4 つのほかはおすすめに出さない", () => {
    const kinds = new Set(
      [none, { ...none, unusedNotes: 9 }, { ...none, seriesFormats: 1 }, { ...none, destinations: 1 }].map((m) => suggestKind(m).kind),
    );
    expect([...kinds].sort()).toEqual(["notes", "pillars", "product", "series"]);
  });
});

describe("設計の頻度の文を読む", () => {
  it.each([
    ["毎日", 7],
    ["毎日 1 本", 7],
    ["1日1回", 7],
    ["週 3", 3],
    ["週3回くらい", 3],
    ["週に２回", 2],
    ["週に二回は出したい", 2],
    ["週 7", 7],
    ["X は週 2、Threads も週 2", 2],
  ])("「%s」は %d", (text, n) => {
    expect(parseFrequency(text)).toBe(n);
  });

  it.each([null, "", "できるだけ", "週 2〜3", "X は毎日、Instagram は週 2", "週 8", "週 10", "月 4 回", "隔週"])("「%s」は読めない（null）", (text) => {
    expect(parseFrequency(text)).toBeNull();
  });
});

describe("どのくらい: 時刻", () => {
  it("数字があれば BAND_INFO.at（閲覧を先に、なければクリック）", () => {
    expect(suggestTime(["threads"], nightViews)).toMatchObject({ time: "21:00", source: "trend" });
    expect(suggestTime(["threads"], nightViews).reason).toBe("これまでの投稿は夜（20〜5 時）によく見られています");
    expect(suggestTime(["x"], eveningClicks)).toMatchObject({ time: "18:00", source: "trend" });
    expect(suggestTime(["x"], eveningClicks).reason).toContain("よくクリックされて");
  });

  it("数字がなければ送り先の初期値で多いもの（同じ数なら 19:00）", () => {
    expect(suggestTime(["threads", "x"], noTrend)).toMatchObject({ time: "19:00", source: "default" });
    expect(suggestTime(["threads", "facebook"], null)).toMatchObject({ time: "12:00", source: "default" });
    expect(suggestTime(["threads", "facebook"], null).reason).toBe("Threads・Facebookでよく見られる時間帯の目安です");
    expect(suggestTime(["instagram"], null).time).toBe("19:00");
    expect(suggestTime(["facebook"], null).time).toBe("12:00");
  });

  it("初期値のない SNS だけなら 19:00", () => {
    expect(suggestTime(["note"], null)).toMatchObject({ time: "19:00", source: "default", reason: "よく見られる時間帯の目安です" });
    expect(suggestTime([], null).time).toBe("19:00");
  });
});

describe("どのくらい: 3 案", () => {
  const base = { targets: ["threads", "x"] as const, trends: null, planFrequency: null };

  it("メモの残りで、2 週間以上続けられる回数のうち多いほうを先にする", () => {
    const at = (n: number) => suggestSchedules({ ...base, targets: [...base.targets], kind: "notes", materials: { ...none, unusedNotes: n } });
    expect(at(14).map((s) => s.label)).toEqual(["毎日", "週 3", "週 2"]);
    expect(at(12).map((s) => s.label)).toEqual(["週 3", "週 2", "毎日"]);
    expect(at(12)[0].reason).toBe("メモが 12 件あるので 4 週間続けられます");
    expect(at(4).map((s) => s.label)).toEqual(["週 2", "毎日", "週 3"]);
    // どれも 2 週間もたなければ、いちばん少ない週 2 を先に
    expect(at(3)[0].label).toBe("週 2");
    expect(at(3)[1].reason).toBe("メモが 3 件なので、1 週間もたずに使い切ります");
  });

  it("使い切らない使い道（シリーズ・商品の紹介・柱）は毎日を先にする", () => {
    const s = suggestSchedules({ ...base, targets: [...base.targets], kind: "series", materials: none });
    expect(s.map((x) => x.label)).toEqual(["毎日", "週 3", "週 2"]);
    expect(s.every((x) => !x.fromPlan)).toBe(true);
  });

  it("設計の頻度が読めれば、それを先にする（3 案のまま）", () => {
    const s = suggestSchedules({ ...base, targets: [...base.targets], kind: "pillars", materials: none, planFrequency: "週に1回" });
    expect(s.map((x) => x.label)).toEqual(["週 1", "毎日", "週 3"]);
    expect(s[0]).toMatchObject({ fromPlan: true, reason: "設計の頻度（週 1）に合わせました", schedule: { weekdays: [3], every_weeks: 1 } });
    expect(s[0].schedule.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const n = suggestSchedules({ ...base, targets: [...base.targets], kind: "notes", materials: { ...none, unusedNotes: 9 }, planFrequency: "週 3" });
    expect(n.map((x) => x.label)).toEqual(["週 3", "週 2", "毎日"]);
    expect(n[0].reason).toBe("設計の頻度（週 3）に合わせました。メモが 9 件あるので 3 週間続けられます");
  });

  it("曜日と時刻（週 2 は火・金。時刻はどの案も同じ）", () => {
    const s = suggestSchedules({ ...base, targets: [...base.targets], kind: "notes", materials: { ...none, unusedNotes: 4 }, trends: nightViews, start: "2026-11-17" });
    expect(s[0].schedule).toEqual({ weekdays: [2, 5], time: "21:00", every_weeks: 1, start: "2026-11-17" });
    // 曜日は ISO（1 = 月〜7 = 日）
    expect(s.find((x) => x.perWeek === 7)?.schedule.weekdays).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.find((x) => x.perWeek === 3)?.schedule.weekdays).toEqual([1, 3, 5]);
    expect(new Set(s.map((x) => x.timeSource))).toEqual(new Set(["trend"]));
  });

  it("どの案も、保存の確かめ（scheduleSchema）に通る形", () => {
    for (const freq of [null, "毎日", "週 1", "週 4", "週 5", "週 6"]) {
      for (const s of suggestSchedules({ ...base, targets: [...base.targets], kind: "pillars", materials: none, planFrequency: freq })) {
        expect(scheduleSchema.safeParse(s.schedule).success).toBe(true);
      }
    }
  });
});
