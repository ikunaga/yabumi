// 自動の投稿のくり返しの規則・入力の確かめ・偽の AI の入口（docs/design/auto-post.md の 2.2。src/lib/auto-post）
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fakeAiMode, fakeGenerator } from "@/lib/auto-post/ai";
import { dueTimes, nextDueTime, runsPerMonth } from "@/lib/auto-post/schedule";
import { autoPlanInputSchema } from "@/lib/auto-post/schema";
import { TARGET_MODES, type AutoPlanInput } from "@/lib/auto-post/types";

const jst = (iso: string) => new Date(`${iso}+09:00`);
const iso = (d: Date[]) => d.map((x) => new Date(x.getTime() + 9 * 3_600_000).toISOString().slice(0, 16));

describe("くり返しの規則（dueTimes）", () => {
  // 2026-11-16 は月曜
  it("曜日と時刻（日本時間）で、from より後・until までを出す", () => {
    const s = { weekdays: [2, 5], time: "19:00", every_weeks: 1 as const, start: "2026-11-16" };
    expect(iso(dueTimes(s, jst("2026-11-16T00:00"), jst("2026-11-30T23:59")))).toEqual([
      "2026-11-17T19:00",
      "2026-11-20T19:00",
      "2026-11-24T19:00",
      "2026-11-27T19:00",
    ]);
  });

  it("from と同じ時刻は出さない（もう過ぎた回）", () => {
    const s = { weekdays: [2], time: "19:00", every_weeks: 1 as const, start: "2026-11-16" };
    expect(iso(dueTimes(s, jst("2026-11-17T19:00"), jst("2026-11-24T19:00")))).toEqual(["2026-11-24T19:00"]);
  });

  it("2 週ごとは、数え始めの日の週から数える", () => {
    const s = { weekdays: [1], time: "09:00", every_weeks: 2 as const, start: "2026-11-18" };
    expect(iso(dueTimes(s, jst("2026-11-16T00:00"), jst("2026-12-31T00:00")))).toEqual([
      "2026-11-30T09:00",
      "2026-12-14T09:00",
      "2026-12-28T09:00",
    ]);
  });

  it("数え始めの日より前は出さない。月をまたいでも、0 時台の回は日本時間の日付で数える", () => {
    const s = { weekdays: [1, 2, 3, 4, 5, 6, 7], time: "00:15", every_weeks: 1 as const, start: "2026-11-30" };
    expect(iso(dueTimes(s, jst("2026-11-28T00:00"), jst("2026-12-02T00:00")))).toEqual(["2026-11-30T00:15", "2026-12-01T00:15"]);
  });

  it("次の回と、30 日あたりの回数", () => {
    const s = { weekdays: [2, 5], time: "19:00", every_weeks: 1 as const, start: "2026-11-16" };
    expect(nextDueTime(s, jst("2026-11-17T20:00"))?.toISOString()).toBe(jst("2026-11-20T19:00").toISOString());
    expect(runsPerMonth(s)).toBe(9);
    expect(runsPerMonth({ ...s, weekdays: [1, 2, 3, 4, 5, 6, 7] })).toBe(30);
    expect(runsPerMonth({ ...s, weekdays: [1], every_weeks: 2 })).toBe(2);
  });
});

const input = (over: Partial<AutoPlanInput> = {}): AutoPlanInput => ({
  name: "ネタ帳から",
  kind: "notes",
  materials: { note_order: "old_first" },
  targets: { threads: "auto", x: "review" },
  xLink: "never",
  schedule: { weekdays: [2, 5], time: "19:00", every_weeks: 1, start: "2026-11-16" },
  instructions: [],
  image: null,
  leadHours: 24,
  consent: true,
  ...over,
});

describe("入力の確かめ（autoPlanInputSchema。DB の save_auto_plan と同じ決まり）", () => {
  it("ふつうの入力は通る", () => {
    expect(autoPlanInputSchema.safeParse(input()).success).toBe(true);
  });

  it("同意がなければ通らない", () => {
    expect(autoPlanInputSchema.safeParse(input({ consent: false as true })).success).toBe(false);
  });

  it("X・TikTok・YouTube は確かめて送るだけ、note・Substack は手動で投稿だけ（4.1）", () => {
    expect(TARGET_MODES.x).toEqual(["review"]);
    expect(TARGET_MODES.note).toEqual(["by_hand"]);
    expect(autoPlanInputSchema.safeParse(input({ targets: { x: "auto" } })).success).toBe(false);
    expect(autoPlanInputSchema.safeParse(input({ targets: { note: "auto" } })).success).toBe(false);
    expect(autoPlanInputSchema.safeParse(input({ targets: { threads: "review" } })).success).toBe(true);
  });

  it("TikTok・YouTube は段階 A では選べない。送り先がないと通らない", () => {
    expect(autoPlanInputSchema.safeParse(input({ targets: { tiktok: "review" } })).success).toBe(false);
    expect(autoPlanInputSchema.safeParse(input({ targets: {} })).success).toBe(false);
  });

  it("シリーズはフォーマットが要る。段階 B の使い道はまだ選べない", () => {
    expect(autoPlanInputSchema.safeParse(input({ kind: "series", materials: {} })).success).toBe(false);
    expect(autoPlanInputSchema.safeParse(input({ kind: "series", materials: { format_id: "00000000-0000-4000-8000-000000000000" } })).success).toBe(true);
    expect(autoPlanInputSchema.safeParse(input({ kind: "rerun" })).success).toBe(false);
  });

  it("時刻は 15 分刻み、曜日は重ならない、材料は決まったキーだけ", () => {
    expect(autoPlanInputSchema.safeParse(input({ schedule: { weekdays: [2], time: "19:10", every_weeks: 1, start: "2026-11-16" } })).success).toBe(false);
    expect(autoPlanInputSchema.safeParse(input({ schedule: { weekdays: [2, 2], time: "19:00", every_weeks: 1, start: "2026-11-16" } })).success).toBe(false);
    expect(autoPlanInputSchema.safeParse(input({ materials: { other: 1 } as never })).success).toBe(false);
  });
});

describe("偽の AI の入口", () => {
  it("AUTO_POST_FAKE_AI があるときだけ使う。Vercel の上では使わない", () => {
    expect(fakeAiMode({} as NodeJS.ProcessEnv)).toBeNull();
    expect(fakeAiMode({ AUTO_POST_FAKE_AI: "1" } as unknown as NodeJS.ProcessEnv)).toBe("ok");
    expect(fakeAiMode({ AUTO_POST_FAKE_AI: "held" } as unknown as NodeJS.ProcessEnv)).toBe("held");
    expect(fakeAiMode({ AUTO_POST_FAKE_AI: "1", VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("偽の AI は、SNS ごとの文（字数の上限まで）・指摘・書けないを返す", async () => {
    const base = { ownerId: "u", kind: "notes" as const, sns: ["threads" as const, "x" as const], material: "m", materialLabel: "メモ", context: "", instructions: [], recentBodies: [], maxLength: { x: 10 }, dueAt: new Date() };
    const ok = await fakeGenerator("ok")(base);
    expect(ok.ok && Object.keys(ok.texts)).toEqual(["threads", "x"]);
    expect(ok.ok && ok.texts.x!.length).toBe(10);
    const held = await fakeGenerator("held")(base);
    expect(held.ok && held.issues?.[0]?.kind).toBe("made_up");
    expect((await fakeGenerator("cannot")(base)).ok).toBe(false);
  });
});
