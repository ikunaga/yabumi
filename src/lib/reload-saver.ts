// 「新しい版があります」の帯から、書きかけを下書きに保存してから読み込み直す（2026-11-18 PMO の付箋 16）。
// 投稿をつくるの画面が、書きかけがあるあいだだけ保存の手順をここに置き、帯（AppStatusBar）が読む。
// 保存できると画面は保存した下書きへ移る（サーバーの redirect）。帯はその移動を見てから読み込み直す

// onFail: 保存できなかった（理由は画面のエラーの帯に出る）
export type ReloadSaver = (onFail: () => void) => void;

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

// 保存のあとに移った先か（下書きに保存すると ?done=saved の付いた投稿の画面へ移る。src/lib/posts/actions.ts の savePost）
export function savedAfter(before: string, now: string): boolean {
  if (before === now) return false;
  try {
    return new URL(now).searchParams.get("done") === "saved";
  } catch {
    return false;
  }
}
