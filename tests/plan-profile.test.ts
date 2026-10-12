import { describe, expect, it } from "vitest";
import { effectiveProfile, handleMismatches, profileIssues, profileTargetSns } from "@/lib/plan/profile";
import { normalizePlan, parseSectionForm } from "@/lib/plan/schema";
import { toSectionValue, toWireValue } from "@/lib/ai/plan-coach-schema";
import { describeSection } from "@/lib/plan/describe";

function form(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const base = { displayName: "まさ", handle: "tsukurikake", handleBackups: "", bio: "個人でアプリを作っています。", link: "https://example.com" };

describe("名前とプロフィールを SNS ごとに変える（D26）", () => {
  it("前の版（bySns なし）は、共通だけとして読む", () => {
    const p = normalizePlan({ profile: base }, "").profile;
    expect(p.bySns).toEqual({});
    expect(effectiveProfile(p, "x")).toMatchObject({ displayName: "まさ", handle: "tsukurikake", overridden: [] });
  });

  it("上書きした項目だけ SNS ごとの値になり、空の項目は共通を使う", () => {
    const p = normalizePlan({ profile: { ...base, bySns: { instagram: { displayName: "", handle: "", bio: "作品が好きな人へ", link: "" } } } }, "").profile;
    const ig = effectiveProfile(p, "instagram");
    expect(ig).toMatchObject({ displayName: "まさ", bio: "作品が好きな人へ", overridden: ["bio"] });
    expect(effectiveProfile(p, "x").bio).toBe("個人でアプリを作っています。");
  });

  it("Threads のユーザー名は、上書きがなければ Instagram と同じ（Instagram から切り離した Threads は別にできる）", () => {
    const p = normalizePlan({ profile: { ...base, bySns: { instagram: { handle: "tsukurikake.app" } } } }, "").profile;
    expect(effectiveProfile(p, "threads").handle).toBe("tsukurikake.app");
    const q = normalizePlan({ profile: { ...base, bySns: { instagram: { handle: "tsukurikake.app" }, threads: { handle: "tsukurikake_th" } } } }, "").profile;
    expect(effectiveProfile(q, "threads").handle).toBe("tsukurikake_th");
  });

  it("フォームの SNS ごとの欄は、どれかが入っている SNS だけ保存する", () => {
    const r = parseSectionForm("profile", form({ ...base, "sns-x-handle": "tsukurikake8", "sns-instagram-bio": " ", "sns-tiktok-displayName": "" }));
    expect(r.success && r.data.bySns).toEqual({ x: { displayName: "", handle: "tsukurikake8", bio: "", link: "" } });
  });

  it("SNS の決まりに合わないところを知らせる（X のユーザー名は 15 字まで、自己紹介文は 160 字まで）", () => {
    const p = normalizePlan({ profile: { ...base, handle: "tsukurikake_app_jp", bio: "あ".repeat(155) } }, "").profile;
    expect(profileIssues(p, "x").map((i) => i.field)).toEqual(["handle"]);
    expect(profileIssues(p, "instagram").map((i) => i.field)).toEqual(["bio"]);
    expect(profileIssues(normalizePlan({ profile: { ...base, handle: "tsukuri.kake" } }, "").profile, "x")[0].message).toContain("英字・数字・_");
    expect(profileIssues(normalizePlan({ profile: base }, "").profile, "x")).toEqual([]);
    expect(profileIssues(normalizePlan({ profile: { ...base, handle: "kakeibo." } }, "").profile, "tiktok")[0].message).toContain("ピリオド");
    expect(profileIssues(normalizePlan({ profile: { ...base, handle: "かけいぼ日和" } }, "").profile, "youtube")).toEqual([]);
    expect(profileIssues(normalizePlan({ profile: { ...base, handle: "_kakeibo" } }, "").profile, "youtube")[0].message).toContain("最初と最後");
  });

  it("SNS ごとの欄を並べるのは、役割を書いた SNS・つないだ SNS・上書きがある SNS", () => {
    const plan = normalizePlan({ profile: { ...base, bySns: { note: { bio: "長文で振り返り" } } }, cadence: { roles: { x: "開発の話", instagram: "作品の感想" } } }, "");
    expect(profileTargetSns(plan, ["threads"])).toEqual(["x", "threads", "instagram", "note"]);
  });

  it("つないだアカウントのユーザー名と設計が違えば知らせる（大文字・小文字と @ は区別しない）", () => {
    const p = normalizePlan({ profile: base }, "").profile;
    expect(
      handleMismatches(p, [
        { sns: "x", handle: "tsukurikake8" },
        { sns: "instagram", handle: "@TsukuriKake" },
        { sns: "threads", handle: "tsukurikake.app" },
      ]),
    ).toEqual([
      { sns: "x", planned: "tsukurikake", actual: "tsukurikake8" },
      { sns: "threads", planned: "tsukurikake", actual: "tsukurikake.app" },
    ]);
  });

  it("AI の案の bySns から、知らない SNS と空の上書きを外す", () => {
    const v = toSectionValue("profile", {
      ...base,
      bySns: { instagram: { displayName: "", handle: "", bio: "作品が好きな人へ", link: "" }, mastodon: { bio: "a" }, x: { bio: " " } },
    });
    expect(v && (v as { bySns: unknown }).bySns).toEqual({ instagram: { displayName: "", handle: "", bio: "作品が好きな人へ", link: "" } });
    // 前の版の案（bySns なし）も読める
    expect(toSectionValue("profile", base)).toMatchObject({ bySns: {} });
  });

  it("相談の履歴では、SNS ごとの役割を案の形（配列）に戻す", () => {
    expect(toWireValue("cadence", { frequency: "週 3", roles: { x: "開発" } })).toEqual({ frequency: "週 3", roles: [{ sns: "x", role: "開発" }] });
  });

  it("案の表示に SNS ごとの上書きを出す", () => {
    const p = normalizePlan({ profile: { ...base, bySns: { instagram: { bio: "作品が好きな人へ" } } } }, "").profile;
    expect(describeSection("profile", p)).toContainEqual({ label: "Instagram 用", text: "自己紹介文 作品が好きな人へ" });
  });
});
