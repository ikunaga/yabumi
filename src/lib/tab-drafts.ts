import { FORM_DRAFT_PREFIX, parseFormDraft, type FormDraft } from "./form-draft";

// 投稿をつくるの書きかけの控えを、タブごとに分ける（docs/architecture.md の 4.65）。
// 前は控えの鍵が「post:new:<プロジェクト>」の 1 つだけで、2 つのタブで開くと、ほかのタブの書きかけの帯が出て、上書きもされた（2026-11-13 PMO2 の確かめ 13）。
// - タブの id は sessionStorage に持つ（読み込み直しても同じ）。控えの鍵は「<元の鍵>#<タブの id>」
// - 開いているタブは、localStorage に 10 秒ごとに印（いまの時刻）を書く。25 秒より新しい印があるタブは開いていると見なす。
//   BroadcastChannel の問い合わせと違い、返事を待たずにその場で決められ、使えないブラウザでも同じに動く。
//   iPhone の Safari などで裏のタブが止まって印が古くなると、閉じたタブと見なして、その控えを戻す候補に出すことがある。
//   戻すと控えを写して引き取るだけで、元のタブの控えは消さないので、書いたものはなくならない
// - 開いたときは、まず自分のタブの控え（読み込み直したとき）。なければ、閉じたタブの控えのうちいちばん新しいもの（前の版の、# のない鍵も）
// - タブを閉じる・読み込み直すとき（pagehide）は印を消す。「タブを複製」は sessionStorage が写るので、同じ id の印が新しければ、別の id にする

const TAB_KEY = "yabumi-tab-id";
const ALIVE_PREFIX = "yabumi-tab-alive:";
export const HEARTBEAT_MS = 10_000;
export const ALIVE_MS = 25_000;
// 同じ元の鍵で残す控えの数（閉じたタブの控えが増えすぎないように）
export const KEEP_TAB_DRAFTS = 3;

type Env = { local: Storage; session: Storage; now: () => number };

function env(): Env | null {
  try {
    return { local: window.localStorage, session: window.sessionStorage, now: Date.now };
  } catch {
    return null;
  }
}

let current: string | null = null;

// いまのタブの id（画面でだけ。storage が使えなければ null で、前と同じ 1 つの鍵を使う）
export function tabId(e: Env | null = env()): string | null {
  if (current) return current;
  if (!e) return null;
  try {
    let id = e.session.getItem(TAB_KEY);
    // 複製したタブ: 同じ id のタブがまだ開いている（印が新しい）なら、別の id にする。読み込み直しでは pagehide で印を消しているので、同じ id のまま
    if (id && isAlive(e, id)) id = null;
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      e.session.setItem(TAB_KEY, id);
    }
    current = id;
    startHeartbeat(e, id);
    return id;
  } catch {
    return null;
  }
}

function beat(e: Env, id: string) {
  try {
    e.local.setItem(ALIVE_PREFIX + id, String(e.now()));
  } catch {
    // 書けなくても、閉じたタブと見なされるだけ（控えはなくならない）
  }
}

function startHeartbeat(e: Env, id: string) {
  beat(e, id);
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  window.setInterval(() => beat(e, id), HEARTBEAT_MS);
  window.addEventListener("pagehide", () => {
    try {
      e.local.removeItem(ALIVE_PREFIX + id);
    } catch {
      // 消せなくても、25 秒たてば閉じたと見なされる
    }
  });
  // 戻る・進むで画面が戻ってきたら、また印を書く
  window.addEventListener("pageshow", () => beat(e, id));
}

export function isAlive(e: Env, id: string): boolean {
  const at = Number(e.local.getItem(ALIVE_PREFIX + id));
  return Number.isFinite(at) && at > 0 && e.now() - at < ALIVE_MS;
}

export function tabDraftKey(base: string, id: string | null): string {
  return id ? `${base}#${id}` : base;
}

// 元の鍵の控えの一覧（自分のタブの分・ほかのタブの分・前の版の # のない分）
function draftKeys(e: Env, base: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < e.local.length; i++) {
    const k = e.local.key(i);
    if (!k?.startsWith(FORM_DRAFT_PREFIX)) continue;
    const rest = k.slice(FORM_DRAFT_PREFIX.length);
    if (rest === base || rest.startsWith(`${base}#`)) keys.push(rest);
  }
  return keys;
}

const tabOf = (key: string) => (key.includes("#") ? key.slice(key.lastIndexOf("#") + 1) : null);

// 開いたときに戻す候補の控え（鍵と元の文字。useSyncExternalStore の値にするので、文字にして返す）。
// 自分のタブの控えがあればそれ。なければ、開いているほかのタブの分を除いた、いちばん新しい控え
export function rawTabDraft(base: string, owner: string | null, e: Env | null = env()): string | null {
  if (!e) return null;
  try {
    const id = tabId(e);
    const own = id ? e.local.getItem(FORM_DRAFT_PREFIX + tabDraftKey(base, id)) : null;
    if (own) return JSON.stringify({ key: tabDraftKey(base, id), raw: own });
    let best: { key: string; raw: string; at: number } | null = null;
    for (const key of draftKeys(e, base)) {
      const t = tabOf(key);
      if (t && (t === id || isAlive(e, t))) continue;
      const raw = e.local.getItem(FORM_DRAFT_PREFIX + key);
      const d = parseFormDraft<unknown>(raw, owner, e.now());
      if (raw && d && (!best || d.at > best.at)) best = { key, raw, at: d.at };
    }
    return best ? JSON.stringify({ key: best.key, raw: best.raw }) : null;
  } catch {
    return null;
  }
}

export function readTabDraft(text: string | null | undefined): { key: string; raw: string } | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as { key?: unknown; raw?: unknown };
    return typeof v.key === "string" && typeof v.raw === "string" ? { key: v.key, raw: v.raw } : null;
  } catch {
    return null;
  }
}

// 閉じたタブの控えを減らす（自分と、開いているタブの分は残す。新しいものから keep 個まで）
export function pruneTabDrafts(base: string, keep = KEEP_TAB_DRAFTS, e: Env | null = env()): void {
  if (!e) return;
  try {
    const id = tabId(e);
    const others = draftKeys(e, base)
      .filter((k) => {
        const t = tabOf(k);
        return !(t && (t === id || isAlive(e, t)));
      })
      .map((k) => ({ k, at: (JSON.parse(e.local.getItem(FORM_DRAFT_PREFIX + k) ?? "null") as FormDraft<unknown> | null)?.at ?? 0 }))
      .sort((a, b) => b.at - a.at);
    for (const { k } of others.slice(keep)) e.local.removeItem(FORM_DRAFT_PREFIX + k);
  } catch {
    // 減らせなくても、30 日で消える
  }
}

// テスト用: いまのタブの id を忘れる
export function resetTabIdForTest() {
  current = null;
}
