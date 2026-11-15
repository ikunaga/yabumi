// ブラウザで動画を整える前の判定（docs/design/video.md の 2.）: 受け付けない理由・作り直したあとの縦横・使う範囲・進み具合の文
import { describe, expect, it } from "vitest";
import { clampRange, defaultRange, outputSize, probeProblem, probeProblemMessage, progressLabel } from "@/lib/media/video-plan";

describe("受け付けない理由", () => {
  const ok = { durationMs: 30_000, width: 1080, height: 1920, audio: "aac" as const };
  it("3 秒未満・小さすぎる・作り直せない音声を断り、音声なしと 90 秒を超える動画（範囲を選ぶ）は受け付ける", () => {
    expect(probeProblem(ok)).toBeNull();
    expect(probeProblem({ ...ok, audio: "none" })).toBeNull();
    expect(probeProblem({ ...ok, durationMs: 300_000 })).toBeNull();
    expect(probeProblem({ ...ok, durationMs: 2_000 })).toBe("too_short");
    expect(probeProblem({ ...ok, width: 320, height: 568 })).toBe("too_small");
    expect(probeProblem({ ...ok, audio: "other" })).toBe("audio");
    expect(probeProblemMessage("audio")).toContain("音声は扱えません");
  });
});

describe("作り直したあとの縦横（9:16 の枠）", () => {
  it("大きな縦の動画は 1080×1920 に、横の動画も 1080×1920 の枠に収める（上下に帯）", () => {
    expect(outputSize(2160, 3840)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(3840, 2160)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(1920, 1080)).toEqual({ width: 1080, height: 1920 });
  });

  it("小さな動画は拡大しない（枠を小さくする。縦横は偶数）。540×960 に足りない枠は null", () => {
    expect(outputSize(720, 1280)).toEqual({ width: 720, height: 1280 });
    expect(outputSize(1280, 720)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(540, 960)).toEqual({ width: 540, height: 960 });
    expect(outputSize(601, 1001)).toEqual({ width: 602, height: 1068 });
    expect(outputSize(480, 854)).toBeNull();
    // 横長は枠の幅で決まるので、小さめでも 540×960 以上の枠になる（上下に帯）
    expect(outputSize(854, 480)).toEqual({ width: 854, height: 1518 });
    expect(outputSize(480, 270)).toBeNull();
    expect(outputSize(0, 0)).toBeNull();
  });
});

describe("使う範囲", () => {
  it("初期値は全体か、最初の 90 秒", () => {
    expect(defaultRange(42_000)).toEqual({ startMs: 0, endMs: 42_000 });
    expect(defaultRange(150_000)).toEqual({ startMs: 0, endMs: 90_000 });
  });

  it("始まりを動かすと終わりが合い、終わりを動かすと始まりが合う（3〜90 秒、動画の中）", () => {
    expect(clampRange({ startMs: 30_000, endMs: 90_000 }, 150_000, "start")).toEqual({ startMs: 30_000, endMs: 90_000 });
    expect(clampRange({ startMs: 0, endMs: 120_000 }, 150_000, "end")).toEqual({ startMs: 30_000, endMs: 120_000 });
    expect(clampRange({ startMs: 10_000, endMs: 110_000 }, 150_000, "start")).toEqual({ startMs: 10_000, endMs: 100_000 });
    expect(clampRange({ startMs: 50_000, endMs: 51_000 }, 150_000, "start")).toEqual({ startMs: 50_000, endMs: 53_000 });
    expect(clampRange({ startMs: 50_000, endMs: 51_000 }, 150_000, "end")).toEqual({ startMs: 48_000, endMs: 51_000 });
    expect(clampRange({ startMs: 149_000, endMs: 150_000 }, 150_000, "start")).toEqual({ startMs: 147_000, endMs: 150_000 });
    expect(clampRange({ startMs: -5, endMs: 200_000 }, 60_000, "end")).toEqual({ startMs: 0, endMs: 60_000 });
  });
});

it("進み具合の文", () => {
  expect(progressLabel("convert", 0.456)).toBe("動画を整えています 45%");
  expect(progressLabel("upload", 1.2)).toBe("上げています 100%");
});
