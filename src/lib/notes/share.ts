import { MAX_NOTE_CHARS, sharedText } from "./rules";

// ほかのアプリからの「共有」（Web Share Target。docs/architecture.md の 4.26）。
// ふつうは service worker（public/sw.js）が POST /share/receive を受け、ブラウザの中（Cache Storage）に置いてから /share を開く。
// service worker がまだ動いていないときだけ、サーバーの /share/receive が受け、本文だけを短い間 cookie に置く（画像は受け取れない）

export const SHARE_COOKIE = "yabumi_share";
// cookie は 4KB まで。日本語は URL エンコード（cookie に置くときに付く）で 1 字 9 バイトになるので、本文はここまで
export const SHARE_COOKIE_CHARS = 300;
export const SHARE_COOKIE_SECONDS = 10 * 60;

// service worker と /share の画面が使う、ブラウザの中の置き場所
export const SHARE_CACHE = "yabumi-share";
export const SHARE_CACHE_TEXT = "/share/pending/text";
export const SHARE_CACHE_IMAGE = "/share/pending/image";

export type SharedPayload = { text: string; hadFile: boolean };

// cookie の値（JSON）。URL エンコードは cookie に置くときに付き、読むときに外れる
export function encodeShareCookie(p: SharedPayload): string {
  return JSON.stringify({ t: p.text.slice(0, SHARE_COOKIE_CHARS), f: p.hadFile ? 1 : 0 });
}

export function decodeShareCookie(raw: string | undefined): SharedPayload | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { t?: unknown; f?: unknown };
    if (typeof v.t !== "string") return null;
    return { text: v.t.slice(0, MAX_NOTE_CHARS), hadFile: v.f === 1 };
  } catch {
    return null;
  }
}

// iOS のショートカットやブックマークレットから開く /share#text=...（# のあとはサーバーに送られない）
export function textFromHash(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return sharedText({ title: params.get("title"), text: params.get("text"), url: params.get("url") });
}
