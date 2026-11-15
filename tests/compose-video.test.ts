// 投稿をつくるの動画（docs/design/video.md の 4.）: 送れない SNS の判定、③ の問題、リセットの一覧、書きかけの控え
import { describe, expect, it } from "vitest";
import { SNS, SNS_KEYS, checkTarget } from "@/lib/sns";
import { problemsByStep } from "@/lib/posts/compose-steps";
import { composeChanges, type ComposeSnapshot } from "@/lib/posts/compose-reset";
import { postDraftBase, samePostDraft, type PostDraft } from "@/lib/posts/post-draft";

describe("動画を送れない SNS", () => {
  it("動画を添えると、yabumi からまだ動画を送れない自動の SNS に video_unsupported を出す。手で投稿する SNS には出さない", () => {
    for (const sns of SNS_KEYS) {
      const issues = checkTarget(sns, "本文", { images: 0, videos: 1 }, "題").issues;
      expect(issues.includes("video_unsupported")).toBe(SNS[sns].delivery === "auto" && !SNS[sns].video);
    }
  });

  it("動画がなければ出さない。動画だけの SNS は、動画があれば「動画が必要」を出さない", () => {
    expect(checkTarget("threads", "本文", { images: 0, videos: 0 }).issues).not.toContain("video_unsupported");
    expect(checkTarget("youtube", "本文", { images: 0, videos: 0 }).issues).toContain("needs_video");
    expect(checkTarget("youtube", "本文", { images: 0, videos: 1 }).issues).not.toContain("needs_video");
    // Instagram は動画があれば「画像が必要」にならない
    expect(checkTarget("instagram", "本文", { images: 0, videos: 1 }).issues).not.toContain("needs_image");
  });

  it("送れない理由は ③ 画像・動画のステップの問題として出る", () => {
    const problems = problemsByStep({
      issues: [{ sns: "x", label: "X", issues: ["video_unsupported"], override: false, issueLabel: () => "動画を送れません" }],
      noTargets: false,
      missingConnect: [],
      reconnect: [],
      needsTime: false,
    });
    expect(problems).toContainEqual({ step: 3, text: "X: 動画を送れません" });
  });
});

describe("リセットと書きかけの控え", () => {
  const base: ComposeSnapshot = { body: "", overrides: {}, titles: {}, imageIds: [], videoId: null, plannedAt: "", targets: [], shortLinks: true, noteIds: [] };
  it("動画を足す・入れ替えると、リセットで消えるものに出す", () => {
    expect(composeChanges(base, { ...base, videoId: "v1" }, { saved: false })).toContain("添えた動画");
    expect(composeChanges({ ...base, videoId: "v1" }, { ...base, videoId: "v2" }, { saved: true })).toContain("添えた動画の変更");
    expect(composeChanges(base, { ...base }, { saved: false })).toEqual([]);
  });

  it("控えの比べる中身に動画を入れる。動画がなければ前の版と同じ文字", () => {
    const d: PostDraft = { body: "a", overrides: {}, titles: {} };
    expect(postDraftBase({ ...d, video: null })).toBe(postDraftBase(d));
    expect(postDraftBase({ ...d, video: { id: "v1" } })).not.toBe(postDraftBase(d));
    expect(samePostDraft({ ...d, video: { id: "v1" } }, { ...d, video: { id: "v1" } })).toBe(true);
    expect(samePostDraft({ ...d, video: { id: "v1" } }, d)).toBe(false);
  });
});

describe("PMO の確かめ（2026-11-15）での直し", () => {
  it("送り終えて動画を消した投稿に送り先を足すと、③ の問題として先に出す", async () => {
    const { VIDEO_REMOVED_TEXT } = await import("@/lib/posts/compose-steps");
    const problems = problemsByStep({ issues: [], noTargets: false, missingConnect: [], reconnect: [], needsTime: false, videoRemoved: true });
    expect(problems).toEqual([{ step: 3, text: VIDEO_REMOVED_TEXT }]);
  });

  it("大きさの表示は、ちょうどのときに小数を付けない", async () => {
    const { formatBytes } = await import("@/lib/media/rules");
    expect(formatBytes(300 * 1024 * 1024)).toBe("300MB");
    expect(formatBytes(7.3 * 1024 * 1024)).toBe("7.3MB");
    expect(formatBytes(2048)).toBe("2KB");
  });

  it("上げ終えて確かめている間は「動画を確かめています」（％を出さない）", async () => {
    const { progressLabel } = await import("@/lib/media/video-plan");
    expect(progressLabel("confirm", 1)).toBe("動画を確かめています");
  });
});
