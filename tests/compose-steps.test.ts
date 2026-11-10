// 投稿をつくるのステップ（docs/design/compose-steps.md）: 開いたときのステップ・?step・次へ進める条件・問題のあるステップ・進みの印・欄のエラーのステップ、
// 書きかけの控えにステップを足しても、控えを残す・出す決まり（書いたときだけ残す・保存し直されたら出さない）が変わらないこと
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMPOSE_STEPS, blockerStep, canGoNext, fieldErrorStep, parseStep, problemsByStep, startStep, stepMarks, stepNo, type StepNo } from "@/lib/posts/compose-steps";
import { parseFormDraft, rawFormDraft, usableFormDraft, writeFormDraft } from "@/lib/form-draft";
import { draftStep, postDraftBase, samePostDraft, type PostDraft } from "@/lib/posts/post-draft";
import { setDraftOwner } from "@/lib/notes/draft";
import { ISSUE_LABEL } from "@/lib/sns";

describe("ステップの区切りと開き方", () => {
  it("5 つのステップを、書く・送り先・画像・リンク・送るの順に並べる", () => {
    expect(COMPOSE_STEPS.map((s) => s.label)).toEqual(["書く", "送り先", "画像", "リンク", "送る"]);
    expect(stepNo("images")).toBe(3);
  });

  it("新しい投稿は ①、保存した下書きは ⑤ のまとめから。保存していても本文が空なら ①", () => {
    expect(startStep({ saved: false, body: "書きかけ" })).toBe(1);
    expect(startStep({ saved: true, body: "金曜に焼きます" })).toBe(5);
    expect(startStep({ saved: true, body: "  " })).toBe(1);
  });

  it("?step は 1〜5 だけ。ほかは開いたときのステップ", () => {
    expect(parseStep("3", 1)).toBe(3);
    for (const bad of [null, "", "0", "6", "2.5", "x", "12"]) expect(parseStep(bad, 5)).toBe(5);
  });

  it("次へ: ① は本文があるとき、② は SNS を 1 つ以上選んだとき、③・④ はいつでも、⑤ にはない", () => {
    expect(canGoNext(1, { body: " ", chosen: 1 })).toBe(false);
    expect(canGoNext(1, { body: "金曜", chosen: 0 })).toBe(true);
    expect(canGoNext(2, { body: "金曜", chosen: 0 })).toBe(false);
    expect(canGoNext(2, { body: "金曜", chosen: 2 })).toBe(true);
    expect(canGoNext(3, { body: "", chosen: 0 })).toBe(true);
    expect(canGoNext(4, { body: "", chosen: 0 })).toBe(true);
    expect(canGoNext(5, { body: "金曜", chosen: 2 })).toBe(false);
  });
});

describe("問題のあるステップ", () => {
  const base = { noTargets: false, missingConnect: [], reconnect: [], needsTime: false };
  const issueLabel = (i: keyof typeof ISSUE_LABEL) => ISSUE_LABEL[i];

  it("文面の問題は、SNS ごとの文面があれば ②、なければ本文の ①。画像の問題は ③、日時は ⑤", () => {
    const ps = problemsByStep({
      ...base,
      needsTime: true,
      issues: [
        { sns: "x", label: "X", issues: ["too_long"], override: false, issueLabel },
        { sns: "threads", label: "Threads", issues: ["too_long"], override: true, issueLabel },
        { sns: "instagram", label: "Instagram", issues: ["needs_image", "bad_aspect_ratio"], override: false, issueLabel },
        { sns: "note", label: "note", issues: ["needs_title"], override: false, issueLabel },
      ],
    });
    expect(ps.map((p) => [p.step, p.text.split(":")[0]])).toEqual([
      [1, "X"],
      [2, "Threads"],
      [2, "note"],
      [3, "Instagram"],
      [3, "Instagram"],
      [5, "送る日時を決めてください"],
    ]);
  });

  it("送り先がない・つないでいないは ②、画像のつなぎ直しは ③", () => {
    const ps = problemsByStep({ ...base, issues: [], noTargets: true, missingConnect: ["X"], reconnect: ["X"] });
    expect(ps.map((p) => p.step)).toEqual([2, 2, 3]);
    expect(ps[1].text).toBe("X をつなぐと送れます");
  });

  it("進みの印: 通ったステップは ✓、問題は通ったか前のステップだけ ●（開く前の先のステップには出さない）", () => {
    const problems = [{ step: 2 as StepNo, text: "送り先の SNS を選んでください" }];
    const fresh = stepMarks({ current: 1, visited: new Set([1]), problems, filled: { 1: true } });
    expect(fresh).toEqual({ 1: "todo", 2: "todo", 3: "todo", 4: "todo", 5: "todo" });
    const later = stepMarks({ current: 3, visited: new Set([1, 2, 3]), problems, filled: { 1: true } });
    expect(later).toEqual({ 1: "done", 2: "problem", 3: "todo", 4: "todo", 5: "todo" });
    // 下書きを ⑤ から開いたとき: 前のステップの問題も、中身のあるステップの ✓ も出す
    const draft = stepMarks({ current: 5, visited: new Set([5]), problems, filled: { 1: true, 3: true } });
    expect(draft).toEqual({ 1: "done", 2: "problem", 3: "done", 4: "todo", 5: "todo" });
  });

  it("送れない理由は、同じ文の問題のステップで直す（引用など、ステップで直すものでなければ null）", () => {
    const problems = problemsByStep({ ...base, needsTime: true, issues: [{ sns: "x", label: "X", issues: ["too_long"], override: true, issueLabel }] });
    expect(blockerStep(`X: ${ISSUE_LABEL.too_long}`, problems)).toBe(2);
    expect(blockerStep("送る日時を決めてください", problems)).toBe(5);
    expect(blockerStep("引用は X の画面で送ります（yabumi からは予約・送信できません）", problems)).toBeNull();
    expect(blockerStep(null, problems)).toBeNull();
  });

  it("保存で返ってきた欄のエラーは、いちばん前の欄のステップへ", () => {
    expect(fieldErrorStep({})).toBeNull();
    expect(fieldErrorStep({ plannedAt: "x", media: "y" })).toBe(3);
    expect(fieldErrorStep({ targets: "x", body: "y" })).toBe(1);
    expect(fieldErrorStep({ plannedAt: "x" })).toBe(5);
  });
});

class MemoryStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe("書きかけの控えにステップを足す（実装担当1 の決まりは変えない）", () => {
  const OWNER = "11111111-1111-4111-8111-111111111111";
  const saved: PostDraft = { body: "金曜に焼きます", overrides: {}, titles: {} };
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage(), dispatchEvent: () => true };
    setDraftOwner(OWNER);
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    setDraftOwner(null);
  });

  it("ステップは比べる中身に入らない（ステップだけ違っても、開いたときと同じ）", () => {
    expect(samePostDraft({ ...saved, step: 3 }, saved)).toBe(true);
    expect(postDraftBase({ ...saved, step: 4 })).toBe(postDraftBase(saved));
  });

  it("書いたときだけ残す・開いたときと同じなら消す、はステップがあっても同じ", () => {
    expect(draftStep({ same: samePostDraft({ ...saved, step: 2 }, saved), typed: true })).toBe("clear");
    expect(draftStep({ same: samePostDraft({ ...saved, body: "金曜に焼きます。", step: 2 }, saved), typed: false })).toBe("none");
    expect(draftStep({ same: samePostDraft({ ...saved, body: "金曜に焼きます。", step: 2 }, saved), typed: true })).toBe("write");
  });

  it("ステップつきの控えを戻すとステップも戻り、保存し直されていれば（base が違えば）出さない", () => {
    const now: PostDraft = { body: "金曜に焼きます。20 個です", overrides: {}, titles: {}, step: 3 };
    writeFormDraft("post:p1", now, postDraftBase(saved));
    const d = parseFormDraft<PostDraft>(rawFormDraft("post:p1"), OWNER);
    const usable = usableFormDraft(d, postDraftBase(saved), (v) => samePostDraft(v, saved));
    expect(usable?.value.step).toBe(3);
    expect(parseStep(String(usable?.value.step), 5)).toBe(3);
    const resaved: PostDraft = { body: "金曜に焼きます（直した）", overrides: {}, titles: {} };
    expect(usableFormDraft(d, postDraftBase(resaved), (v) => samePostDraft(v, resaved))).toBeNull();
  });

  it("前の版の控え（ステップのないもの）も、そのまま戻せる", () => {
    writeFormDraft("post:p2", { body: "書きかけ", overrides: {}, titles: {} }, postDraftBase(saved));
    const d = parseFormDraft<PostDraft>(rawFormDraft("post:p2"), OWNER);
    expect(usableFormDraft(d, postDraftBase(saved), (v) => samePostDraft(v, saved))?.value.step).toBeUndefined();
  });
});
