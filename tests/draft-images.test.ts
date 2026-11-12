// 書きかけの控えに添えた画像も入れる（docs/architecture.md の 4.62）。比べる中身・土台・戻せる画像の決まり
import { describe, expect, it } from "vitest";
import { draftStep, postDraftBase, samePostDraft, type PostDraft } from "@/lib/posts/post-draft";
import { RESTORE_UNATTACHED_HOURS, draftImagesMayBeGone } from "@/lib/media/rules";
import { restorableRows } from "@/lib/media/store";

const saved: PostDraft = { body: "金曜に焼きます", overrides: {}, titles: {} };
const A = { id: "a", altText: "焼きたて" };
const B = { id: "b", altText: "" };

describe("比べる中身に画像を入れる", () => {
  it("画像の並び・説明文が違えば、開いたときと違う", () => {
    expect(samePostDraft({ ...saved, images: [A, B] }, { ...saved, images: [A, B] })).toBe(true);
    expect(samePostDraft({ ...saved, images: [B, A] }, { ...saved, images: [A, B] })).toBe(false);
    expect(samePostDraft({ ...saved, images: [{ ...A, altText: "焼きたてのパン" }] }, { ...saved, images: [A] })).toBe(false);
    expect(samePostDraft({ ...saved, images: [A] }, saved)).toBe(false);
  });
  it("画像がないのは、前の版の控え（画像の欄がない）と同じ", () => {
    expect(samePostDraft({ ...saved, images: [] }, saved)).toBe(true);
    expect(postDraftBase({ ...saved, images: [] })).toBe(postDraftBase(saved));
  });
  it("保存してある画像が変わったら、土台が変わる（保存し直された控えは出さない）", () => {
    expect(postDraftBase({ ...saved, images: [A] })).not.toBe(postDraftBase({ ...saved, images: [A, B] }));
  });
  it("画像を添えた（自分でした作業）なら控え、開いたときと同じなら消す", () => {
    expect(draftStep({ same: samePostDraft({ ...saved, images: [A] }, saved), typed: true })).toBe("write");
    expect(draftStep({ same: samePostDraft({ ...saved, images: [] }, saved), typed: true })).toBe("clear");
  });
});

describe("戻せる画像（restorableRows。行は利用者の権限で読んだ本人のものだけ）", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  const row = (id: string, post_id: string | null, created_at: string, note_id: string | null = null) => ({ id, post_id, note_id, created_at });
  const rows = [
    row("new", null, hoursAgo(1)),
    row("edge", null, hoursAgo(RESTORE_UNATTACHED_HOURS + 0.1)),
    row("mine", "post-1", hoursAgo(30)),
    row("other", "post-2", hoursAgo(1)),
    row("note", null, hoursAgo(1), "note-1"),
  ];
  it("この投稿の画像と、添えていない新しい画像だけ", () => {
    expect(restorableRows(rows, "post-1", now).map((r) => r.id)).toEqual(["new", "mine"]);
  });
  it("新しい投稿では、添えていない新しい画像だけ（別の投稿・メモの画像・片付けの近い画像は戻さない）", () => {
    expect(restorableRows(rows, null, now).map((r) => r.id)).toEqual(["new"]);
  });
  it("控えが古いと、帯に戻せないことがあると添える", () => {
    expect(draftImagesMayBeGone(now.getTime() - 3600_000, now.getTime())).toBe(false);
    expect(draftImagesMayBeGone(now.getTime() - (RESTORE_UNATTACHED_HOURS + 1) * 3600_000, now.getTime())).toBe(true);
  });
});
