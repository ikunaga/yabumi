// 投稿をつくるの「リセット」・下書きの「保存した内容に戻す」で、モーダルに並べる変えたもの（src/lib/posts/compose-reset.ts。docs/architecture.md の 4.38）
import { describe, expect, it } from "vitest";
import { composeChanges, type ComposeSnapshot } from "@/lib/posts/compose-reset";

const empty: ComposeSnapshot = { body: "", overrides: {}, titles: {}, imageIds: [], plannedAt: "", targets: ["x", "threads"], shortLinks: true, noteIds: [] };

describe("composeChanges（投稿をつくるのリセット）", () => {
  it("開いたときのままなら、何も出さない（ボタンを出さない）", () => {
    expect(composeChanges(empty, { ...empty, targets: ["threads", "x"] }, { saved: false })).toEqual([]);
  });

  it("新しい投稿は、入っているものをそのまま並べる", () => {
    const now: ComposeSnapshot = {
      ...empty,
      body: "新メニュー",
      overrides: { x: "X 用" },
      titles: { note: "題" },
      imageIds: ["a", "b"],
      plannedAt: "2026-11-05T12:00",
      targets: ["x", "note"],
      noteIds: ["n1"],
    };
    expect(composeChanges(empty, now, { saved: false })).toEqual([
      "本文",
      "SNS ごとの文面（X）",
      "note のタイトル",
      "添えた画像 2 枚",
      "送る日時",
      "送り先の選び直し（最初の選び方に戻します）",
      "ネタ帳のメモ 1 件に「投稿にした」の印を付ける予定",
    ]);
  });

  it("空の SNS ごとの文面も変えたものとみなす。空のタイトルは数えない", () => {
    expect(composeChanges(empty, { ...empty, overrides: { threads: "" }, titles: { note: "" } }, { saved: false })).toEqual(["SNS ごとの文面（Threads）"]);
  });

  it("カレンダーから日付つきで開いた投稿は、日時を変えたときだけ「変更」として出す", () => {
    const initial = { ...empty, plannedAt: "2026-11-05T12:00" };
    expect(composeChanges(initial, initial, { saved: false })).toEqual([]);
    expect(composeChanges(initial, { ...initial, plannedAt: "2026-11-06T12:00" }, { saved: false })).toEqual(["送る日時の変更"]);
  });

  it("保存済みの下書きは、保存した内容から変えたものを「〜の変更」で出す", () => {
    const saved: ComposeSnapshot = { ...empty, body: "保存した本文", imageIds: ["a"], plannedAt: "2026-11-05T12:00" };
    expect(composeChanges(saved, saved, { saved: true })).toEqual([]);
    expect(composeChanges(saved, { ...saved, body: "直した", imageIds: [], shortLinks: false, targets: ["x"] }, { saved: true })).toEqual([
      "本文の変更",
      "添えた画像の変更",
      "送り先の選び直し",
      "短縮リンクのオン・オフ",
    ]);
  });
});
