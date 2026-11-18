// 「新しい版があります」の帯から、書きかけを下書きに保存してから読み込み直す（2026-11-18 PMO の付箋 16）。
// 投稿をつくるの画面が、書きかけがあるあいだだけ保存の手順をここに置き、帯（AppStatusBar）が読む。
// 保存できると画面は保存した下書きへ移る（サーバーの redirect）。帯はその移動を見てから読み込み直す。
// 移ったかは、保存のたびに作る合図（token）が移った先の URL の ?r= に付いたかで見る。URL が変わったかでは見ない
// （?done=saved&step=N の画面で同じ段のまま保存し直すと、移る先が今と同じ URL になり、移ったと判定できなかった。2026-11-18 のセキュリティ確認）

// token: 保存した下書きへ移るときに URL に付ける合図。onFail: 保存できなかった（理由は画面のエラーの帯に出る）
export type ReloadSaver = (token: string, onFail: () => void) => void;

// 合図の形（サーバーが redirect の URL に入れるので、英小文字と数字だけ。src/lib/posts/schema.ts の reloadToken）
export const RELOAD_TOKEN_RE = /^[a-z0-9]{8,32}$/;

export function newReloadToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("");
}

let saver: ReloadSaver | null = null;
const listeners = new Set<() => void>();

export function setReloadSaver(fn: ReloadSaver | null): void {
  if (saver === fn) return;
  saver = fn;
  for (const l of listeners) l();
}

export function getReloadSaver(): ReloadSaver | null {
  return saver;
}

export function subscribeReloadSaver(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

// この保存のあとに移った先か（下書きに保存すると ?done=saved&r=<合図> の付いた投稿の画面へ移る。src/lib/posts/actions.ts の savePost）
export function savedWith(now: string, token: string): boolean {
  try {
    const q = new URL(now).searchParams;
    return q.get("done") === "saved" && q.get("r") === token;
  } catch {
    return false;
  }
}
