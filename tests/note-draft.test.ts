// 書きかけのメモの控え（src/lib/notes/draft.ts）。保存するまで端末に残し、黙って捨てない
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDraft, mergeShared, NOTE_DRAFT_DAYS, NOTE_DRAFT_KEY, parseDraft, readDraft, saveFailureMessage, writeDraft } from "@/lib/notes/draft";

class MemoryStorage {
  map = new Map<string, string>();
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

let events = 0;
beforeEach(() => {
  events = 0;
  (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage(), dispatchEvent: () => (events++, true) };
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("控えの読み書き", () => {
  it("書いた本文と保存先を残し、読み直せる。書き換えたら知らせる", () => {
    writeDraft("朝の電車で思いついた", "p1");
    expect(readDraft()).toMatchObject({ body: "朝の電車で思いついた", projectId: "p1" });
    expect(events).toBe(1);
  });

  it("本文を空にしたら・保存できて消したら、控えはなくなる", () => {
    writeDraft("あ", null);
    writeDraft("   ", null);
    expect(readDraft()).toBeNull();
    writeDraft("い", null);
    clearDraft();
    expect(readDraft()).toBeNull();
  });

  it("localStorage が使えなくても止まらない", () => {
    (globalThis as { window?: unknown }).window = {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
      dispatchEvent: () => true,
    };
    expect(() => writeDraft("あ", null)).not.toThrow();
    expect(readDraft()).toBeNull();
  });

  it("壊れた値・空・古すぎる控えは戻さない", () => {
    const now = Date.now();
    expect(parseDraft("{", now)).toBeNull();
    expect(parseDraft(JSON.stringify({ body: " ", at: now }), now)).toBeNull();
    expect(parseDraft(JSON.stringify({ body: "あ", at: now - (NOTE_DRAFT_DAYS + 1) * 86_400_000 }), now)).toBeNull();
    expect(parseDraft(JSON.stringify({ body: "あ", projectId: 3, at: now }), now)).toEqual({ body: "あ", projectId: null, at: now });
    expect(NOTE_DRAFT_KEY).toBe("yabumi-note-draft");
  });
});

describe("共有で受け取ったものを控えに足す", () => {
  it("前の書きかけを上書きせずに後ろに足す。同じものは二重に足さない", () => {
    expect(mergeShared("", "https://example.com")).toBe("https://example.com");
    expect(mergeShared("書きかけ", "https://example.com")).toBe("書きかけ\n\nhttps://example.com");
    expect(mergeShared("書きかけ\n\nhttps://example.com", "https://example.com")).toBe("書きかけ\n\nhttps://example.com");
    expect(mergeShared("書きかけ", "  ")).toBe("書きかけ");
  });
});

describe("保存できなかったときの知らせ", () => {
  it("通信が切れている・yabumi が新しくなった・そのほかで分け、どれも本文を残していると書く", () => {
    const offline = saveFailureMessage(null, false);
    expect(offline.message).toContain("通信がつながっていない");
    const err = new Error('Server Action "abc" was not found on the server.');
    err.name = "UnrecognizedActionError";
    const stale = saveFailureMessage(err, true);
    expect(stale).toMatchObject({ reload: true });
    expect(stale.message).toContain("読み込み直して");
    const other = saveFailureMessage(new TypeError("Failed to fetch"), true);
    expect(other.reload).toBe(false);
    for (const m of [offline, stale, other]) expect(m.message).toContain("書いた内容はこの端末に残しています");
  });
});

describe("古い控えの片付け", () => {
  it("30 日より古い控えは、読んだときに消す", () => {
    const s = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;
    s.setItem(NOTE_DRAFT_KEY, JSON.stringify({ body: "古い", projectId: null, at: Date.now() - (NOTE_DRAFT_DAYS + 1) * 86_400_000 }));
    expect(readDraft()).toBeNull();
    expect(s.getItem(NOTE_DRAFT_KEY)).toBeNull();
  });
});
