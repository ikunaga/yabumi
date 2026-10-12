// ネタ帳（F17）の決まり（docs/architecture.md の 4.26）。画面とサーバーの両方から読む

// メモの本文の上限（DB の check と同じ）
export const MAX_NOTE_CHARS = 2000;
// 1 つのプロジェクトに残せるメモの数。画像は 4.18 の容量（1 人 100MB）の中で数える
export const MAX_NOTES_PER_PROJECT = 1000;
// 「AI とネタを出す」で一度に選べるメモの数
export const MAX_NOTES_FOR_IDEAS = 10;

export type NoteImage = { id: string; previewUrl: string | null; width: number; height: number };

export type IdeaNote = {
  id: string;
  projectId: string;
  body: string;
  usedAt: string | null;
  postId: string | null;
  createdAt: string;
  image: NoteImage | null;
};

// 共有で受け取ったもの（タイトル・本文・URL）を 1 つの本文にまとめる。同じ文が重なれば 1 つにする
export function sharedText(parts: { title?: string | null; text?: string | null; url?: string | null }): string {
  let out: string[] = [];
  for (const raw of [parts.title, parts.text, parts.url]) {
    const s = (raw ?? "").trim();
    if (!s || out.some((o) => o.includes(s))) continue;
    // 前のものを含む文が来たら、前のものを外す（題名を含む本文など）
    out = [...out.filter((o) => !s.includes(o)), s];
  }
  return out.join("\n").slice(0, MAX_NOTE_CHARS);
}
