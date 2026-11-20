import { describe, expect, it } from "vitest";
import { imagesStepNext } from "@/lib/posts/compose-steps";
import { isProcessing, RESULT_POLL_MAX, RESULT_POLL_MS } from "@/lib/posts/send-mode";
import { getReloadSaver, newReloadToken, RELOAD_TOKEN_RE, savedWith, setReloadSaver, subscribeReloadSaver } from "@/lib/reload-saver";
import { savePostInputSchema } from "@/lib/posts/schema";

// 2026-11-18 PMO の SP の通し（連想映画クイズ）で見つかった、投稿をつくるのわかりづらいところ

describe("③ の「次へ」（付箋 15）", () => {
  it("画像も動画もなく、画像が要る送り先があれば、名前を変えて注意を出す", () => {
    expect(imagesStepNext({ hasMedia: false, needImage: ["Instagram"], needVideo: [] })).toEqual({
      label: "付けずに次へ",
      note: "Instagram は画像か動画が要ります。付けないまま Instagram を選んでいると、送れません",
    });
  });
  it("動画が要る送り先も並べる", () => {
    const r = imagesStepNext({ hasMedia: false, needImage: ["Instagram"], needVideo: ["TikTok", "YouTube"] });
    expect(r.label).toBe("付けずに次へ");
    expect(r.note).toContain("TikTok・YouTube は動画");
    expect(r.note).toContain("Instagram・TikTok・YouTube");
  });
  it("要る送り先がなければ、いままでの名前", () => {
    expect(imagesStepNext({ hasMedia: false, needImage: [], needVideo: [] })).toEqual({ label: "画像・動画なしで次へ", note: null });
  });
  it("画像か動画を付けていれば、ふつうの「次へ」", () => {
    expect(imagesStepNext({ hasMedia: true, needImage: ["Instagram"], needVideo: [] })).toEqual({ label: null, note: null });
  });
});

describe("下書きに保存したステップ（付箋 17）", () => {
  const step = savePostInputSchema.shape.step;
  it("1〜5 を受け取る（省いてもよい）", () => {
    for (const n of [1, 3, 5, undefined]) expect(step.safeParse(n).success).toBe(true);
  });
  it("範囲の外・小数は受け取らない（redirect の URL に入るので）", () => {
    for (const n of [0, 6, 2.5, "3"]) expect(step.safeParse(n).success).toBe(false);
  });
});

describe("送信の結果の読み直し（付箋 25）", () => {
  it("SNS の側で処理している状態だけ読み直す", () => {
    expect(isProcessing("preparing")).toBe(true);
    expect(isProcessing("publishing")).toBe(true);
    for (const s of ["pending", "published", "failed", "deleted", "awaiting_approval"] as const) expect(isProcessing(s)).toBe(false);
  });
  it("間隔と回数に上限がある（10 分まで）", () => {
    expect(RESULT_POLL_MS).toBeGreaterThanOrEqual(15_000);
    expect(RESULT_POLL_MS * RESULT_POLL_MAX).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe("新しい版の帯から下書きに保存（付箋 16）", () => {
  it("保存の手順を置く・外すと、帯に知らせる", () => {
    let n = 0;
    const off = subscribeReloadSaver(() => n++);
    const fn = () => {};
    setReloadSaver(fn);
    expect(getReloadSaver()).toBe(fn);
    setReloadSaver(fn);
    setReloadSaver(null);
    off();
    setReloadSaver(fn);
    setReloadSaver(null);
    expect(n).toBe(2);
  });
  it("この保存の合図が付いた下書きの画面に移ったときだけ、読み込み直す", () => {
    const t = "abc12345xyz";
    expect(savedWith("https://yabumi.app/projects/p/posts/abc?done=saved&step=3&r=abc12345xyz", t)).toBe(true);
    // 移っていない・前の保存の画面のまま
    expect(savedWith("https://yabumi.app/projects/p/posts/new?step=3", t)).toBe(false);
    expect(savedWith("https://yabumi.app/projects/p/posts/abc?done=saved&step=3", t)).toBe(false);
    expect(savedWith("https://yabumi.app/projects/p/posts/abc?done=saved&step=3&r=old0000000", t)).toBe(false);
  });
  it("すでに ?done=saved の画面で同じ段のまま保存し直しても、移ったと気づく（2026-11-18 のセキュリティ確認）", () => {
    // 前は「URL が変わったか」で見ていたので、移る先が今と同じ URL になり、30 秒後に「保存できませんでした」と出た
    const here = "https://yabumi.app/projects/p/posts/abc?done=saved&step=2";
    const t = newReloadToken();
    const after = `https://yabumi.app/projects/p/posts/abc?done=saved&step=2&r=${t}`;
    expect(savedWith(here, t)).toBe(false);
    expect(savedWith(after, t)).toBe(true);
  });
  it("合図は毎回変わり、サーバーが受け取る形に収まる", () => {
    const a = newReloadToken();
    expect(a).toMatch(RELOAD_TOKEN_RE);
    expect(newReloadToken()).not.toBe(a);
    const r = savePostInputSchema.shape.reloadToken;
    expect(r.safeParse(a).success).toBe(true);
    expect(r.safeParse(undefined).success).toBe(true);
    // redirect の URL に入るので、記号は受け取らない
    for (const bad of ["x&done=sent", "a/b", "short", "A".repeat(10), "a".repeat(33)]) expect(r.safeParse(bad).success).toBe(false);
  });
});

