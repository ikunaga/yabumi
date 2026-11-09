// 画面の書きかけの控え（src/lib/form-draft.ts。docs/architecture.md の 4.35）。本人にだけ戻し、ログアウトで消す
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearFormDraft, FORM_DRAFT_DAYS, FORM_DRAFT_PREFIX, parseFormDraft, readFormDraft, usableFormDraft, writeFormDraft } from "@/lib/form-draft";
import { draftStep, postDraftBase, samePostDraft } from "@/lib/posts/post-draft";
import { clearNoteDraftsOnDevice, setDraftOwner } from "@/lib/notes/draft";

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

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: store, dispatchEvent: () => true };
  setDraftOwner(ALICE);
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  setDraftOwner(null);
});

describe("画面の書きかけの控え", () => {
  it("書いた人にだけ戻す。別の人・ログインの前には戻さない", () => {
    writeFormDraft("post:new:p1", { body: "書きかけの投稿" });
    expect(readFormDraft("post:new:p1")).toMatchObject({ value: { body: "書きかけの投稿" }, owner: ALICE });
    setDraftOwner(BOB);
    expect(readFormDraft("post:new:p1")).toBeNull();
    setDraftOwner(null);
    expect(readFormDraft("post:new:p1")).toBeNull();
  });

  it("いまの人がわからないときは書かない", () => {
    setDraftOwner(null);
    writeFormDraft("plan:p1:goal", [["what", "x"]]);
    expect(store.length).toBe(0);
  });

  it("保存できたら消す。古すぎる・壊れた控えは戻さない", () => {
    writeFormDraft("plan:p1:goal", [["what", "x"]]);
    clearFormDraft("plan:p1:goal");
    expect(readFormDraft("plan:p1:goal")).toBeNull();
    const now = Date.now();
    expect(parseFormDraft(JSON.stringify({ value: 1, at: now - (FORM_DRAFT_DAYS + 1) * 86_400_000, owner: ALICE }), ALICE, now)).toBeNull();
    expect(parseFormDraft("{", ALICE, now)).toBeNull();
  });

  it("ログアウト・退会で、この端末の画面の書きかけをすべて消す（ほかのキーは残す）", async () => {
    writeFormDraft("post:new:p1", { body: "a" });
    writeFormDraft("plan:p1:goal", [["what", "b"]]);
    store.setItem("yabumi-theme-other", "keep");
    await clearNoteDraftsOnDevice();
    expect([...store.map.keys()].filter((k) => k.startsWith(FORM_DRAFT_PREFIX))).toEqual([]);
    expect(store.getItem("yabumi-theme-other")).toBe("keep");
  });
});

describe("書きかけを出す・残す決まり（2026-11-09 オーナーの指摘「下書きとかした記憶ないのに、しょっちゅう残っている」）", () => {
  it("書き始めたときの保存してある値（base）が、いま開いた画面の値と同じ控えだけ出す。そのあと保存し直したもの・base のない前の控え・いまと同じ中身は出さない", () => {
    writeFormDraft("post:p1", { body: "書きかけ" }, "base-1");
    const d = readFormDraft<{ body: string }>("post:p1");
    expect(d?.base).toBe("base-1");
    const differs = () => false;
    expect(usableFormDraft(d, "base-1", differs)?.value).toEqual({ body: "書きかけ" });
    // ほかの画面・AI の案で保存し直した
    expect(usableFormDraft(d, "base-2", differs)).toBeNull();
    // いまの値と同じ
    expect(usableFormDraft(d, "base-1", () => true)).toBeNull();
    // base のない前の控え
    writeFormDraft("post:p2", { body: "前の控え" });
    expect(usableFormDraft(readFormDraft("post:p2"), "base-1", differs)).toBeNull();
    expect(usableFormDraft(null, "base-1", differs)).toBeNull();
  });

  it("投稿をつくる: 開いたときと同じなら消す。違っても、欄に書いていなければ（ボタンで入れた値だけ）残さない。1 文字書くと残す", () => {
    expect(draftStep({ same: true, typed: false })).toBe("clear");
    expect(draftStep({ same: true, typed: true })).toBe("clear");
    expect(draftStep({ same: false, typed: false })).toBe("none");
    expect(draftStep({ same: false, typed: true })).toBe("write");
  });

  it("投稿をつくる: 比べる前に形をそろえる（空の文面・タイトルは無いのと同じ。SNS の並びは関係ない）", () => {
    const a = { body: "本文", overrides: { x: "X 用", instagram: "" }, titles: {} };
    const b = { body: "本文", overrides: { x: "X 用" }, titles: { note: "" } };
    expect(samePostDraft(a, b)).toBe(true);
    expect(postDraftBase(a)).toBe(postDraftBase(b));
    expect(postDraftBase({ body: "", overrides: { x: "1", threads: "2" }, titles: {} })).toBe(postDraftBase({ body: "", overrides: { threads: "2", x: "1" }, titles: {} }));
    // SNS ごとの文面を作るボタン（本文を写すだけ）は、開いたときと違う
    expect(samePostDraft({ body: "本文", overrides: { x: "本文" }, titles: {} }, { body: "本文", overrides: {}, titles: {} })).toBe(false);
  });
});
