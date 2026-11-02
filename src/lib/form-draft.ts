import { getDraftOwner } from "@/lib/notes/draft";

// 画面の書きかけの控え（docs/architecture.md の 4.35）。投稿をつくるの本文と、アカウント設計の欄を、保存できるまでこの端末の localStorage に置く。
// 古い画面で保存できず読み込み直したとき・画面を閉じてしまったときに、次に開いた画面で「保存していない書きかけがあります」と出して戻せるようにする。
// ネタ帳の控え（src/lib/notes/draft.ts）と同じ決まり: 持ち主（いまログインしている人）のものだけを戻す。持ち主がわからないときは書かない。
// ログアウト・退会で消す（clearAllFormDrafts）。30 日より古いものは戻さずに消す

export const FORM_DRAFT_PREFIX = "yabumi-form-draft:";
export const FORM_DRAFT_DAYS = 30;

export type FormDraft<T> = { value: T; at: number; owner: string };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseFormDraft<T>(raw: string | null, owner: string | null, now: number = Date.now()): FormDraft<T> | null {
  if (!raw || !owner) return null;
  try {
    const v = JSON.parse(raw) as Partial<FormDraft<T>>;
    if (typeof v.at !== "number" || typeof v.owner !== "string" || v.value === undefined) return null;
    if (v.owner !== owner || now - v.at > FORM_DRAFT_DAYS * 86_400_000) return null;
    return { value: v.value as T, at: v.at, owner: v.owner };
  } catch {
    return null;
  }
}

// 控えの元の文字（画面を描くときに 1 回読む。useSyncExternalStore の値にするので、文字のまま返す）
export function rawFormDraft(key: string): string | null {
  return storage()?.getItem(FORM_DRAFT_PREFIX + key) ?? null;
}

export function readFormDraft<T>(key: string): FormDraft<T> | null {
  const s = storage();
  const raw = s?.getItem(FORM_DRAFT_PREFIX + key) ?? null;
  const draft = parseFormDraft<T>(raw, getDraftOwner());
  // 古すぎる・壊れた控えは消す（ほかの人の控えは、その人のために残す。いまの人が書けば上書きする）
  if (raw && !draft) {
    try {
      const v = JSON.parse(raw) as Partial<FormDraft<T>>;
      if (typeof v.at !== "number" || Date.now() - v.at > FORM_DRAFT_DAYS * 86_400_000) s?.removeItem(FORM_DRAFT_PREFIX + key);
    } catch {
      s?.removeItem(FORM_DRAFT_PREFIX + key);
    }
  }
  return draft;
}

export function writeFormDraft<T>(key: string, value: T): void {
  const owner = getDraftOwner();
  if (!owner) return;
  try {
    storage()?.setItem(FORM_DRAFT_PREFIX + key, JSON.stringify({ value, at: Date.now(), owner } satisfies FormDraft<T>));
  } catch {
    // 容量が足りないなど。控えられなくても書く・保存するは続けられる
  }
}

export function clearFormDraft(key: string): void {
  try {
    storage()?.removeItem(FORM_DRAFT_PREFIX + key);
  } catch {
    // 消せなくても、次に開いたときに出るだけ
  }
}

// ログアウト・退会のとき: この端末の画面の書きかけをすべて消す
export function clearAllFormDrafts(): void {
  const s = storage();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(FORM_DRAFT_PREFIX)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    // 消せなくても、持ち主の違う控えは出さない
  }
}

// 控えた時刻の見せ方（11/2 14:05）
export function draftTimeLabel(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
