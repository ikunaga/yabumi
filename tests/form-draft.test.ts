// 画面の書きかけの控え（src/lib/form-draft.ts。docs/architecture.md の 4.35）。本人にだけ戻し、ログアウトで消す
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearFormDraft, FORM_DRAFT_DAYS, FORM_DRAFT_PREFIX, parseFormDraft, readFormDraft, writeFormDraft } from "@/lib/form-draft";
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
