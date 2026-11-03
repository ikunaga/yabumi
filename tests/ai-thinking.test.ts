// AI を待っている間の表示（src/components/ui/ai-thinking.tsx・src/lib/ai/thinking.ts。docs/architecture.md の 4.51）:
// 段階の文が経った秒数で切り替わること、動きを減らす設定では動きを止めて秒数だけ進めること、読み上げの範囲
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiThinkingView } from "@/components/ui/ai-thinking";
import { elapsedLabel, elapsedSeconds, THINKING_STAGES, thinkingStage } from "@/lib/ai/thinking";

const html = (props: Partial<Parameters<typeof AiThinkingView>[0]>) =>
  renderToStaticMarkup(createElement(AiThinkingView, { kind: "tidy", seconds: 0, reduced: false, ...props }));

describe("段階の文", () => {
  it("経った秒数で切り替わる（整える: 0・5・15・30 秒）", () => {
    const s = THINKING_STAGES.tidy;
    expect(thinkingStage(s, 0)).toBe("読み込んでいます");
    expect(thinkingStage(s, 4)).toBe("読み込んでいます");
    expect(thinkingStage(s, 5)).toBe("案を考えています");
    expect(thinkingStage(s, 14)).toBe("案を考えています");
    expect(thinkingStage(s, 15)).toBe("文を整えています");
    expect(thinkingStage(s, 30)).toBe("もう少しかかっています");
    expect(thinkingStage(s, 600)).toBe("もう少しかかっています");
  });

  it("会話は「考えています」から始まり、長くかかると「もう少しかかっています」", () => {
    expect(thinkingStage(THINKING_STAGES.chat, 12)).toBe("考えています");
    expect(thinkingStage(THINKING_STAGES.chat, 31)).toBe("もう少しかかっています");
  });

  it("どの種類も 0 秒の段階から始まり、時間の順に並び、最後は「もう少しかかっています」", () => {
    for (const stages of Object.values(THINKING_STAGES)) {
      expect(stages[0].at).toBe(0);
      expect(stages.map((s) => s.at)).toEqual([...stages.map((s) => s.at)].sort((a, b) => a - b));
      expect(stages.at(-1)!.text).toBe("もう少しかかっています");
    }
  });

  it("経った秒数の数え方と出し方", () => {
    expect(elapsedSeconds(1_000, 13_999)).toBe(12);
    expect(elapsedSeconds(5_000, 1_000)).toBe(0);
    expect(elapsedLabel(12)).toBe("12 秒");
    expect(elapsedLabel(65)).toBe("1 分 5 秒");
  });
});

describe("表示", () => {
  it("段階の文と秒数を出し、% は出さない", () => {
    const out = html({ seconds: 16 });
    expect(out).toContain("文を整えています");
    expect(out).toContain("16 秒");
    expect(out).not.toContain("%");
  });

  it("読み上げは段階の文だけ（role=status・aria-live=polite、秒数と動く印は aria-hidden）", () => {
    const out = html({ seconds: 7 });
    expect(out).toMatch(/role="status" aria-live="polite"/);
    expect(out).toMatch(/<span aria-hidden="true" class="num[^"]*">7 秒<\/span>/);
  });

  it("会話: 3 つの点が順に弾み、「考えています」と秒数、目安を下に出す", () => {
    const out = html({ kind: "chat", variant: "chat", seconds: 12, note: "10〜30 秒ほどかかることがあります" });
    expect(out.match(/animate-\[ai-dot/g)).toHaveLength(3);
    expect(out).toContain("animation-delay:0.36s");
    expect(out).toContain("考えています");
    expect(out).toContain("12 秒");
    expect(out).toContain("10〜30 秒ほどかかることがあります");
  });

  it("待つ時間が長いもの: 左右に流れる細いバー", () => {
    expect(html({ seconds: 3 })).toContain("animate-[ai-bar");
  });

  it("動きを減らす設定では、動きを付けず、秒数と段階の文は進める", () => {
    for (const variant of ["chat", "progress"] as const) {
      const out = html({ variant, reduced: true, seconds: 31 });
      expect(out).not.toContain("animate-");
      expect(out).not.toContain("animation-delay");
      expect(out).toContain('data-motion="reduce"');
      expect(out).toContain("31 秒");
      expect(out).toContain("もう少しかかっています");
    }
  });

  it("動きは motion-safe でも包む（設定を読む前の最初の表示でも、動きを減らす設定なら止まる）", () => {
    const out = html({ variant: "chat", seconds: 0 }) + html({ seconds: 0 });
    expect(out.match(/animate-/g)?.length).toBe(out.match(/motion-safe:animate-/g)?.length);
  });

  it("色はトークンだけ（藍と muted）。朱（signal）は使わない", () => {
    const out = html({ variant: "chat", seconds: 0 }) + html({ seconds: 0 });
    expect(out).not.toMatch(/signal|#[0-9a-f]{3,6}\b/i);
    expect(out).toContain("bg-primary");
  });
});
