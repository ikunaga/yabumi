// 動画の決まり（docs/design/video.md の 2.・3.）: サーバーの MP4 の箱の確かめ、ビットレート、置き場所、長さの表示、postVideoFor の読み方
import { describe, expect, it } from "vitest";
import { checkMp4, Mp4CheckError, mp4ProblemMessage, type Mp4Problem } from "@/lib/media/mp4-check";
import { MAX_VIDEO_BYTES, TARGET_VIDEO_BYTES, formatDuration, isOwnVideoPath, videoBitrate, videoPath } from "@/lib/media/video-rules";
import { testMp4, type TestMp4Options } from "./helpers/mp4";

function problem(o: TestMp4Options): Mp4Problem | null {
  try {
    checkMp4(testMp4(o));
    return null;
  } catch (e) {
    if (e instanceof Mp4CheckError) return e.problem;
    throw e;
  }
}

describe("MP4 の箱の確かめ", () => {
  it("yabumi の 1 本の形（H.264・AAC-LC・1080×1920・30fps・moov が先頭）を受け付け、長さ・縦横・fps を読む", () => {
    expect(checkMp4(testMp4({ durationMs: 42_000 }))).toEqual({ durationMs: 42_000, width: 1080, height: 1920, fps: 30, hasAudio: true });
  });

  it("音声なしも受け付ける。回した動画は見た目の縦横で読む", () => {
    expect(checkMp4(testMp4({ audio: "none" })).hasAudio).toBe(false);
    expect(checkMp4(testMp4({ width: 1920, height: 1080, rotate90: true }))).toMatchObject({ width: 1080, height: 1920 });
  });

  it("形が違うものは、理由ごとに受け付けない", () => {
    expect(problem({ moovAfterMdat: true })).toBe("moov_after_mdat");
    expect(problem({ editList: true })).toBe("edit_list");
    expect(problem({ udta: true })).toBe("metadata");
    expect(problem({ videoCodec: "hvc1" })).toBe("video_codec");
    expect(problem({ audio: "opus" })).toBe("audio_codec");
    expect(problem({ audio: "heaac" })).toBe("audio_codec");
    expect(problem({ durationMs: 2_900 })).toBe("too_short");
    expect(problem({ durationMs: 91_000 })).toBe("too_long");
    expect(problem({ width: 480, height: 854 })).toBe("too_small");
    expect(problem({ width: 2160, height: 3840 })).toBe("too_big_dimensions");
    expect(problem({ fps: 15 })).toBe("fps");
  });

  it("90 秒をフレームの区切りで少し超えるのは許す。大きすぎるファイル・MP4 でないもの・壊れた箱は受け付けない", () => {
    expect(problem({ durationMs: 90_300 })).toBeNull();
    expect(() => checkMp4(new Uint8Array(MAX_VIDEO_BYTES + 1))).toThrow(Mp4CheckError);
    expect(() => checkMp4(new TextEncoder().encode("not a video at all"))).toThrow(Mp4CheckError);
    const broken = testMp4();
    expect(() => checkMp4(broken.subarray(0, broken.length - 10))).toThrow(Mp4CheckError);
  });

  it("利用者に見せる文は、直し方がわかる形にする", () => {
    expect(mp4ProblemMessage("too_short")).toContain("3 秒以上");
    expect(mp4ProblemMessage("audio_codec")).toContain("音声は扱えません");
    expect(mp4ProblemMessage("edit_list")).toContain("yabumi の画面から");
  });
});

describe("動画の決まり", () => {
  it("ビットレート: 長さに合わせて 50MB に収め、6Mbps を超えない", () => {
    expect(videoBitrate(10_000, 128_000)).toBe(6_000_000);
    for (const ms of [30_000, 60_000, 90_000]) {
      const v = videoBitrate(ms, 128_000);
      expect(((v + 128_000) * ms) / 1000 / 8).toBeLessThanOrEqual(TARGET_VIDEO_BYTES);
    }
    expect(videoBitrate(90_000, 128_000)).toBeGreaterThan(4_000_000);
  });

  it("置き場所は <利用者の ID>/<乱数>.mp4 だけ", () => {
    const owner = "11111111-2222-3333-4444-555555555555";
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(isOwnVideoPath(owner, videoPath(owner, id))).toBe(true);
    expect(isOwnVideoPath(owner, `${owner}/${id}.jpg`)).toBe(false);
    expect(isOwnVideoPath(owner, `99999999-2222-3333-4444-555555555555/${id}.mp4`)).toBe(false);
    expect(isOwnVideoPath(owner, `${owner}/../${id}.mp4`)).toBe(false);
  });

  it("長さの表示は m:ss", () => {
    expect(formatDuration(42_400)).toBe("0:42");
    expect(formatDuration(90_000)).toBe("1:30");
  });
});
