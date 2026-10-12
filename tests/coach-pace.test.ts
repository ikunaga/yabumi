// 伴走（F18、決定 D29。docs/architecture.md の 4.27）のペースの計算と、知らせの中身
import { describe, expect, it } from "vitest";
import { behindMessage, mailFooter, overdueMessage, unsubscribeHeaders, weeklyMessage } from "@/lib/coach/messages";
import { computeWeekPace, cycleInfo, isoWeekday, mondayOf, remainingText, shouldNudgeBehind, snsStatus, streakWeeks, withFirstMonthCycle } from "@/lib/coach/pace";
import { toSectionValue } from "@/lib/ai/plan-coach-schema";
import { parseSectionForm, sectionSchemas } from "@/lib/plan/schema";

// 2026-10-12 は月曜
const MON = "2026-10-12";

describe("SNS ごとの状態（週は月曜から、送信済み＋予約済みと比べる）", () => {
  it("届いた・予約で届く・まだ", () => {
    expect(snsStatus({ target: 2, published: 2, scheduled: 0 }, "2026-10-13", MON)).toBe("done");
    expect(snsStatus({ target: 2, published: 1, scheduled: 1 }, "2026-10-13", MON)).toBe("on_track");
    expect(snsStatus({ target: 2, published: 0, scheduled: 0 }, "2026-10-13", MON)).toBe("not_yet");
  });

  it("遅れそう: 決めた曜日（既定は水曜）を過ぎて 0 本、残りの日数より足りない、土日でまだ足りない", () => {
    expect(snsStatus({ target: 1, published: 0, scheduled: 0 }, "2026-10-14", MON)).toBe("behind");
    expect(snsStatus({ target: 1, published: 0, scheduled: 0 }, "2026-10-14", MON, 4)).toBe("not_yet");
    expect(snsStatus({ target: 2, published: 1, scheduled: 0 }, "2026-10-15", MON)).toBe("not_yet");
    expect(snsStatus({ target: 5, published: 0, scheduled: 1 }, "2026-10-15", MON)).toBe("not_yet");
    expect(snsStatus({ target: 6, published: 0, scheduled: 1 }, "2026-10-15", MON)).toBe("behind");
    expect(snsStatus({ target: 2, published: 1, scheduled: 0 }, "2026-10-17", MON)).toBe("behind");
    // 終わった週で届かなかった
    expect(snsStatus({ target: 2, published: 1, scheduled: 0 }, "2026-10-19", MON)).toBe("missed");
  });

  it("週のまとめと「あと X 1 本・Instagram 1 本」", () => {
    const p = computeWeekPace({ targets: { x: 2, instagram: 1 }, counts: { x: { published: 1, scheduled: 0 } }, today: "2026-10-14", weekStart: MON });
    expect(p.rows.map((r) => [r.sns, r.status])).toEqual([
      ["x", "not_yet"],
      ["instagram", "behind"],
    ]);
    expect(remainingText(p)).toBe("X 1 本・Instagram 1 本");
    expect(p.achieved).toBe(false);
    expect(p.behind).toBe(true);
    const done = computeWeekPace({ targets: { x: 1 }, counts: { x: { published: 1, scheduled: 0 }, threads: { published: 3, scheduled: 0 } }, today: "2026-10-14", weekStart: MON });
    expect(done.achieved).toBe(true);
    expect(done.rows).toHaveLength(1);
  });

  it("遅れの声かけは、決めた曜日に今週まだ 1 本もない SNS があるときだけ", () => {
    const p = computeWeekPace({ targets: { x: 2, instagram: 1 }, counts: { x: { published: 1, scheduled: 0 } }, today: "2026-10-14", weekStart: MON });
    expect(shouldNudgeBehind(p, "2026-10-14", 3)).toBe(true);
    expect(shouldNudgeBehind(p, "2026-10-15", 3)).toBe(false);
    const ok = computeWeekPace({ targets: { x: 2 }, counts: { x: { published: 0, scheduled: 1 } }, today: "2026-10-14", weekStart: MON });
    expect(shouldNudgeBehind(ok, "2026-10-14", 3)).toBe(false);
  });
});

describe("続けた週と 1 か月", () => {
  it("先週からさかのぼって続けて届いた週。今週が届いていれば足す", () => {
    const past = [
      { weekStart: "2026-09-21", achieved: true },
      { weekStart: "2026-09-28", achieved: false },
      { weekStart: "2026-10-05", achieved: true },
    ];
    expect(streakWeeks(past, MON, false)).toBe(1);
    expect(streakWeeks(past, MON, true)).toBe(2);
    expect(streakWeeks([], MON, false)).toBe(0);
  });

  it("1 か月は数え始めの月曜から 4 週", () => {
    expect(cycleInfo(MON, "2026-10-12")).toMatchObject({ endsOn: "2026-11-08", weekIndex: 1, ended: false });
    expect(cycleInfo(MON, "2026-11-08")).toMatchObject({ weekIndex: 4, ended: false });
    expect(cycleInfo(MON, "2026-11-09")).toMatchObject({ weekIndex: 4, ended: true });
    expect(isoWeekday("2026-10-18")).toBe(7);
    expect(mondayOf("2026-10-18")).toBe(MON);
  });

  it("数え始めの日: 初めて決めたとき・1 か月が終わったあと・次の 1 か月を始めるとき今週の月曜。ほかは前のまま", () => {
    const empty = sectionSchemas.first_month.parse({});
    const next = { ...empty, weekly: { x: 2 } };
    expect(withFirstMonthCycle(next, empty, "2026-10-14").startedOn).toBe(MON);
    expect(withFirstMonthCycle(next, { ...empty, startedOn: "2026-10-05" }, "2026-10-14").startedOn).toBe("2026-10-05");
    expect(withFirstMonthCycle(next, { ...empty, startedOn: "2026-10-05" }, "2026-10-14", true).startedOn).toBe(MON);
    expect(withFirstMonthCycle(next, { ...empty, startedOn: "2026-09-07" }, "2026-10-14").startedOn).toBe(MON);
    // 週の回数がなければ数え始めない
    expect(withFirstMonthCycle(empty, null, "2026-10-14").startedOn).toBeNull();
  });
});

describe("最初の 1 か月の週の回数の形", () => {
  it("フォームの weekly-<SNS> を読む。空欄と 0 は決めない。範囲外は断る。前の版は空", () => {
    const f = new FormData();
    f.set("goal", "続ける");
    f.set("weekly-x", "2");
    f.set("weekly-instagram", "0");
    f.set("weekly-threads", "");
    const r = parseSectionForm("first_month", f);
    expect(r.success && r.data.weekly).toEqual({ x: 2 });
    const bad = new FormData();
    bad.set("weekly-x", "15");
    expect(parseSectionForm("first_month", bad).success).toBe(false);
    expect(sectionSchemas.first_month.parse({ goal: "x", metrics: "", kpis: [] })).toMatchObject({ weekly: {}, startedOn: null });
  });

  it("AI の案の weekly は、知らない SNS と範囲外を外し、数え始めは決めない", () => {
    const v = toSectionValue("first_month", { goal: "g", metrics: "", kpis: ["posts"], weekly: { x: 2.4, mastodon: 3, instagram: 0, threads: 30 }, startedOn: "2020-01-06" });
    expect(v).toMatchObject({ weekly: { x: 2, threads: 14 }, startedOn: null });
  });
});

describe("知らせの中身", () => {
  const ctx = { appUrl: "https://yabumi.app", projectId: "p1", projectName: "かけいぼ日和", unsubscribeToken: "00000000-0000-4000-8000-000000000000" };

  it("遅れそう: あと何本か、SNS ごとの数、ネタへの道。スマホの通知は短く、本文やメールアドレスを入れない", () => {
    const p = computeWeekPace({ targets: { x: 2, instagram: 1 }, counts: { x: { published: 1, scheduled: 0 } }, today: "2026-10-14", weekStart: MON });
    const m = behindMessage(p, ctx);
    expect(m.email.subject).toBe("今週の投稿、あと X 1 本・Instagram 1 本です（かけいぼ日和）");
    expect(m.email.text).toContain("・X: 1 / 2 本");
    expect(m.email.text).toContain("https://yabumi.app/projects/p1/notes");
    expect(m.push).toMatchObject({ title: "今週の投稿、あと 2 本です", url: "/projects/p1", tag: "pace:p1" });
    expect(m.push.title.length).toBeLessThanOrEqual(30);
  });

  it("月曜の振り返り: 先週の結果・続けた週・今週の目標。1 か月が終わったら次の 1 か月へ", () => {
    const m = weeklyMessage(
      { lastWeek: { weekStart: "2026-10-05", targets: { x: 2 }, published: { x: 2 }, achieved: true }, thisWeekTargets: { x: 2 }, streak: 3, cycle: { ...cycleInfo("2026-09-14", "2026-10-11"), achievedWeeks: 3 }, justEnded: true },
      ctx,
    );
    expect(m.email.text).toContain("目標達成です");
    expect(m.email.text).toContain("■ 続けた週: 3 週");
    expect(m.email.text).toContain("4 週のうち 3 週で目標に届きました");
    expect(m.email.text).toContain("/consult/new?start=month_review");
    expect(m.push.tag).toBe("weekly:p1");
  });

  it("予定日を過ぎたやること: 件数・やること（5 件まで）・ロードマップへ。遅れそうな日は同じ知らせに入れる。月曜は先週の件数", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, title: `やること ${i}`, plannedOn: "2026-10-13" }));
    const m = overdueMessage(items, ctx);
    expect(m.email.subject).toBe("予定日を過ぎたやることが 6 件あります（かけいぼ日和）");
    expect(m.email.text).toContain("・10/13 やること 0");
    expect(m.email.text).toContain("・ほか 1 件");
    expect(m.email.text).toContain("https://yabumi.app/projects/p1/roadmap");
    expect(m.push).toMatchObject({ url: "/projects/p1/roadmap", tag: "pace:p1" });
    const p = computeWeekPace({ targets: { x: 1 }, counts: {}, today: "2026-10-14", weekStart: MON });
    expect(behindMessage(p, ctx, items.slice(0, 1)).email.text).toContain("予定日を過ぎたやることが 1 件あります");
    expect(behindMessage(p, ctx).email.text).not.toContain("予定日を過ぎた");
    const w = weeklyMessage({ lastWeek: null, thisWeekTargets: { x: 1 }, streak: 0, cycle: null, justEnded: false, lastWeekOverdue: 2 }, ctx);
    expect(w.email.text).toContain("■ 先週、予定日を過ぎたやること: 2 件");
  });

  it("メールの最後: 何のメールか、設定、ワンクリックの停止、送信者と問い合わせ先。List-Unsubscribe の見出し", () => {
    const f = mailFooter(ctx);
    expect(f).toContain("https://yabumi.app/settings/notifications");
    expect(f).toContain(`https://yabumi.app/unsubscribe?t=${ctx.unsubscribeToken}`);
    expect(f).toContain("送信者: 矢書（運営 YuXport Labs）");
    expect(f).toContain("問い合わせ: contact@yuxport.com");
    expect(unsubscribeHeaders(ctx)).toEqual({ "List-Unsubscribe": `<https://yabumi.app/api/unsubscribe?t=${ctx.unsubscribeToken}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });
});
