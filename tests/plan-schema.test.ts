import { describe, expect, it } from "vitest";
import { SECTION_KEYS, isPlanDone, isSectionDone, normalizePlan, parseSectionForm } from "@/lib/plan/schema";

function form(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("アカウント設計のデータ", () => {
  it("空や壊れたデータは、空の設計として読む", () => {
    const p = normalizePlan({ goal: "broken", pillars: { items: "x" } }, "");
    expect(p.goal).toEqual({ what: "", goalType: null, note: "" });
    expect(p.pillars.items).toEqual([]);
    expect(isPlanDone(p)).toBe(false);
  });

  it("届けたい相手はプロジェクトの値を使う", () => {
    expect(normalizePlan({}, "28 歳の会社員").audience.who).toBe("28 歳の会社員");
  });

  it("目的・届けたい相手・投稿の柱が書けたら済み", () => {
    const p = normalizePlan({ goal: { goalType: "awareness" }, pillars: { items: [{ name: "お金のコツ" }] } }, "会社員");
    expect(isSectionDone("goal", p.goal)).toBe(true);
    expect(isSectionDone("pillars", p.pillars)).toBe(true);
    expect(isPlanDone(p)).toBe(true);
    expect(isPlanDone({ ...p, audience: { ...p.audience, who: " " } })).toBe(false);
  });

  it("投稿の柱は空の行を飛ばし、割合を数にする", () => {
    const r = parseSectionForm(
      "pillars",
      form({ "pillar-0-name": "お金のコツ", "pillar-0-share": "40", "pillar-2-name": "開発の裏側", tone: "です・ます" }),
    );
    expect(r.success && r.data.items).toEqual([
      { name: "お金のコツ", share: 40, example: "" },
      { name: "開発の裏側", share: null, example: "" },
    ]);
  });

  it("割合が 0〜100 でなければ受け付けない", () => {
    const r = parseSectionForm("pillars", form({ "pillar-0-name": "a", "pillar-0-share": "150" }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("割合は 0〜100 の整数にしてください");
    expect(parseSectionForm("pillars", form({ "pillar-0-name": "a", "pillar-0-share": "abc" })).success).toBe(false);
  });

  it("選択肢にない値は受け付けない", () => {
    expect(parseSectionForm("goal", form({ goalType: "hack" })).error?.issues[0].message).toBe("選択肢から選んでください");
    expect(parseSectionForm("ownership", form({ mode: "personal" })).success).toBe(true);
  });

  it("SNS ごとの役割は書いた SNS だけを残す", () => {
    const r = parseSectionForm("cadence", form({ frequency: "週 3 回", "role-x": "短く", "role-tiktok": " " }));
    expect(r.success && r.data.roles).toEqual({ x: "短く" });
  });

  it("長すぎる値は受け付けない", () => {
    expect(parseSectionForm("profile", form({ bio: "あ".repeat(301) })).success).toBe(false);
  });

  it("セクションは 目的 → 届けたい相手 → 投稿の柱 → 持ち方 → 名前 → 頻度 → 最初の 1 か月 の順", () => {
    expect(SECTION_KEYS).toEqual(["goal", "audience", "pillars", "ownership", "profile", "cadence", "first_month"]);
  });

  it("ユーザー名は第一候補と予備に分けて保存する", () => {
    const r = parseSectionForm("profile", form({ handle: "kakeibo_biyori", handleBackups: "a\nb" }));
    expect(r.success && r.data).toMatchObject({ handle: "kakeibo_biyori", handleBackups: "a\nb" });
  });

  it("初版の形（handles に 1 行 1 つ）で保存されたユーザー名は、1 行目を第一候補として読む", () => {
    const p = normalizePlan({ profile: { displayName: "まさ", handles: "first\n second \n\nthird" } }, "");
    expect(p.profile).toMatchObject({ displayName: "まさ", handle: "first", handleBackups: "second\nthird" });
    expect(isSectionDone("profile", normalizePlan({ profile: { handle: "x" } }, "").profile)).toBe(true);
  });
});
