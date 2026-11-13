// 投稿をつくるの書きかけの控えを、タブごとに分ける（docs/architecture.md の 4.65）
import { beforeEach, describe, expect, it } from "vitest";
import { FORM_DRAFT_PREFIX } from "@/lib/form-draft";
import { ALIVE_MS, KEEP_TAB_DRAFTS, pruneTabDrafts, rawTabDraft, readTabDraft, resetTabIdForTest, tabDraftKey, tabId } from "@/lib/tab-drafts";

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
  clear() {
    this.map.clear();
  }
}

const OWNER = "11111111-1111-4111-8111-111111111111";
const BASE = "post:new:p1";
let local: MemoryStorage;
const clock = 1_800_000_000_000;
const now = () => clock;
// 1 つのタブ（sessionStorage はタブごと、localStorage は共有）
const tab = (session = new MemoryStorage()) => ({ local: local as unknown as Storage, session: session as unknown as Storage, now });
const draft = (body: string, at = clock) => JSON.stringify({ value: { body }, at, owner: OWNER, base: "b" });
const put = (key: string, body: string, at = clock) => local.setItem(FORM_DRAFT_PREFIX + key, draft(body, at));
const found = (e: ReturnType<typeof tab>) => {
  const t = readTabDraft(rawTabDraft(BASE, OWNER, e));
  return t ? { key: t.key, body: (JSON.parse(t.raw) as { value: { body: string } }).value.body } : null;
};

beforeEach(() => {
  local = new MemoryStorage();
  resetTabIdForTest();
});

describe("タブの id", () => {
  it("読み込み直しても同じ（sessionStorage）。閉じたとき（pagehide）に印を消すので、同じ id のまま", () => {
    const session = new MemoryStorage();
    const a = tabId(tab(session));
    resetTabIdForTest();
    local.removeItem(`yabumi-tab-alive:${a}`);
    expect(tabId(tab(session))).toBe(a);
  });
  it("複製したタブ（sessionStorage が写る）は、元のタブが開いていれば別の id にする", () => {
    const session = new MemoryStorage();
    const a = tabId(tab(session));
    resetTabIdForTest();
    const copy = new MemoryStorage();
    copy.setItem("yabumi-tab-id", a!);
    expect(tabId(tab(copy))).not.toBe(a);
  });
});

describe("どの控えを戻すか", () => {
  it("自分のタブの控え（読み込み直したとき）を先に戻す", () => {
    const e = tab();
    const me = tabId(e)!;
    put(tabDraftKey(BASE, me), "自分");
    put(tabDraftKey(BASE, "closed1"), "閉じたタブ", clock + 1000);
    expect(found(e)).toEqual({ key: `${BASE}#${me}`, body: "自分" });
  });
  it("開いているほかのタブの控えは出さない（奪い合わない）", () => {
    const e = tab();
    tabId(e);
    local.setItem("yabumi-tab-alive:other", String(clock - 5_000));
    put(tabDraftKey(BASE, "other"), "ほかのタブで書いている");
    expect(found(e)).toBeNull();
  });
  it("閉じたタブ（印が古い・ない）の控えは、いちばん新しいものを戻す候補にする", () => {
    const e = tab();
    tabId(e);
    local.setItem("yabumi-tab-alive:old", String(clock - ALIVE_MS - 1));
    put(tabDraftKey(BASE, "old"), "閉じた A", clock - 60_000);
    put(tabDraftKey(BASE, "gone"), "閉じた B", clock - 1_000);
    expect(found(e)).toEqual({ key: `${BASE}#gone`, body: "閉じた B" });
  });
  it("前の版の、タブに分けていない控えも戻せる", () => {
    const e = tab();
    tabId(e);
    put(BASE, "前の版");
    expect(found(e)).toEqual({ key: BASE, body: "前の版" });
  });
  it("ほかの人の控え・ほかの投稿の控えは戻さない", () => {
    const e = tab();
    tabId(e);
    local.setItem(FORM_DRAFT_PREFIX + `${BASE}#x`, JSON.stringify({ value: { body: "他人" }, at: clock, owner: "someone", base: "b" }));
    put("post:new:p2#y", "別のプロジェクト");
    expect(found(e)).toBeNull();
  });
  it("裏で止まったタブ（iPhone の Safari など）は閉じたと見なすが、控えは写して引き取るだけで、元の控えは残る（なくならない）", () => {
    const e = tab();
    tabId(e);
    local.setItem("yabumi-tab-alive:sleep", String(clock - ALIVE_MS - 10_000));
    put(tabDraftKey(BASE, "sleep"), "止まったタブ");
    expect(found(e)?.body).toBe("止まったタブ");
  });
});

describe("閉じたタブの控えを減らす", () => {
  it(`新しいものから ${KEEP_TAB_DRAFTS} 個まで残し、自分と開いているタブの控えは消さない`, () => {
    const e = tab();
    const me = tabId(e)!;
    put(tabDraftKey(BASE, me), "自分", clock - 999_999);
    local.setItem("yabumi-tab-alive:live", String(clock));
    put(tabDraftKey(BASE, "live"), "開いている", clock - 999_998);
    for (let i = 0; i < 5; i++) put(tabDraftKey(BASE, `c${i}`), `閉じた ${i}`, clock - i * 1000);
    pruneTabDrafts(BASE, KEEP_TAB_DRAFTS, e);
    const left = [...local.map.keys()].filter((k) => k.startsWith(FORM_DRAFT_PREFIX)).map((k) => k.slice(FORM_DRAFT_PREFIX.length)).sort();
    expect(left).toEqual([`${BASE}#${me}`, `${BASE}#c0`, `${BASE}#c1`, `${BASE}#c2`, `${BASE}#live`].sort());
  });
});

describe("storage が使えないとき", () => {
  it("id は null で、前と同じ 1 つの鍵を使う", () => {
    expect(tabId(null)).toBeNull();
    expect(tabDraftKey(BASE, null)).toBe(BASE);
    expect(rawTabDraft(BASE, OWNER, null)).toBeNull();
  });
});
