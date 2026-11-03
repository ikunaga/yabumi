// 書きかけのメモの控え（src/lib/notes/draft.ts）。保存するまで端末に残し、黙って捨てない
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDraft, clearNoteDraftsOnDevice, mergeShared, ownDraft, PENDING_DRAFT_MS, SHARE_IMAGE_KEEP_MS, shareImageDecision, writePendingDraft, NOTE_DRAFT_DAYS, NOTE_DRAFT_KEY, parseDraft, readDraft, saveFailureMessage, setDraftOwner, writeDraft } from "@/lib/notes/draft";
import { SHARE_CACHE } from "@/lib/notes/share";

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
let deletedCaches: string[] = [];
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  events = 0;
  deletedCaches = [];
  const caches = { delete: async (name: string) => (deletedCaches.push(name), true) };
  (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage(), dispatchEvent: () => (events++, true), caches };
  (globalThis as { caches?: unknown }).caches = caches;
  setDraftOwner(ALICE);
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { caches?: unknown }).caches;
  setDraftOwner(null);
});

function store() {
  return (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;
}

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
    expect(parseDraft(JSON.stringify({ body: "あ", projectId: 3, at: now, owner: null }), now)).toEqual({ body: "あ", projectId: null, at: now, owner: null });
    // 持ち主の欄がない形は、誰のものかわからないので戻さない
    expect(parseDraft(JSON.stringify({ body: "あ", at: now }), now)).toBeNull();
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
    const s = store();
    s.setItem(NOTE_DRAFT_KEY, JSON.stringify({ body: "古い", projectId: null, at: Date.now() - (NOTE_DRAFT_DAYS + 1) * 86_400_000, owner: ALICE }));
    expect(readDraft()).toBeNull();
    expect(s.getItem(NOTE_DRAFT_KEY)).toBeNull();
  });
});

describe("別の人には出さない（同じブラウザで別のアカウントがログインしたとき）", () => {
  it("書いた人の控えは、別の人がログインしても戻さない。書いた人がまたログインすれば戻る", () => {
    writeDraft("alice の書きかけ", "p-alice");
    setDraftOwner(BOB);
    expect(readDraft()).toBeNull();
    setDraftOwner(null);
    expect(readDraft()).toBeNull();
    setDraftOwner(ALICE);
    expect(readDraft()).toMatchObject({ body: "alice の書きかけ", owner: ALICE });
  });

  it("別の人が書き始めたら、その人の控えになる（前の人の本文は混ざらない）", () => {
    writeDraft("alice の書きかけ", null);
    setDraftOwner(BOB);
    writeDraft("bob のメモ", null);
    expect(readDraft()).toMatchObject({ body: "bob のメモ", owner: BOB });
    setDraftOwner(ALICE);
    expect(readDraft()).toBeNull();
  });

  it("ログインの前に共有で受け取ったもの（持ち主なし）は、次にログインした人のものになる", () => {
    setDraftOwner(null);
    writePendingDraft("ログインの前に共有した URL");
    expect(JSON.parse(store().getItem(NOTE_DRAFT_KEY)!).owner).toBeNull();
    setDraftOwner(BOB);
    expect(readDraft()).toMatchObject({ body: "ログインの前に共有した URL", owner: BOB });
    setDraftOwner(ALICE);
    expect(readDraft()).toBeNull();
  });
});

describe("ログアウト・退会で消える", () => {
  it("この端末の書きかけ、前に選んだプロジェクトの覚え、共有で受け取って残していたもの（Cache Storage）を消す", async () => {
    writeDraft("ログアウトの前の書きかけ", "p1");
    store().setItem("yabumi-note-project", "p1");
    await clearNoteDraftsOnDevice();
    expect(store().getItem(NOTE_DRAFT_KEY)).toBeNull();
    expect(store().getItem("yabumi-note-project")).toBeNull();
    expect(deletedCaches).toEqual([SHARE_CACHE]);
    // ログアウトのあとは、誰の控えも戻さない
    setDraftOwner(ALICE);
    expect(readDraft()).toBeNull();
  });
});

describe("持ち主のない控えを作らない・長く引き継がない", () => {
  it("いまの人がわからないとき（ログインの前・ログアウトのあと）は、ふつうの書き込みでは控えを作らない", () => {
    setDraftOwner(null);
    writeDraft("ログアウトのあとに打った", null);
    expect(store().getItem(NOTE_DRAFT_KEY)).toBeNull();
  });

  it("ログインの前の共有の控えは、1 時間を過ぎたら次の人に渡さない", () => {
    const now = Date.now();
    const pending = { body: "前の人が残した共有", projectId: null, at: now - PENDING_DRAFT_MS - 1000, owner: null };
    expect(ownDraft(pending, BOB, now)).toBeNull();
    expect(ownDraft({ ...pending, at: now - 1000 }, BOB, now)).toMatchObject({ owner: BOB });
  });
});

describe("共有で受け取った画像の持ち主（セキュリティ確認 2026-11-03 の L5）", () => {
  const now = 1_800_000_000_000;
  it("持ち主がいまの人なら使う（1 日まで）", () => {
    expect(shareImageDecision({ owner: ALICE, at: now - 1000 }, ALICE, now)).toBe("use");
    expect(shareImageDecision({ owner: ALICE, at: now - SHARE_IMAGE_KEEP_MS }, ALICE, now)).toBe("discard");
  });

  it("持ち主なしは、受けてから 1 時間以内ならいまの人のものにする。過ぎたら消す", () => {
    expect(shareImageDecision({ owner: null, at: now - 1000 }, BOB, now)).toBe("claim");
    expect(shareImageDecision({ owner: null, at: now - PENDING_DRAFT_MS - 1 }, BOB, now)).toBe("discard");
  });

  it("ほかの人の画像・ログインしていないとき・時刻のないものは使わずに消す", () => {
    expect(shareImageDecision({ owner: ALICE, at: now - 1000 }, BOB, now)).toBe("discard");
    expect(shareImageDecision({ owner: null, at: now - 1000 }, null, now)).toBe("discard");
    expect(shareImageDecision({ owner: null, at: null }, BOB, now)).toBe("discard");
  });
});
