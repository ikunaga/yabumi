import { MAX_NOTE_CHARS } from "./rules";

// 書きかけのメモの控え（ネタ帳。docs/architecture.md の 4.26）。保存するまで、この端末のブラウザ（localStorage）に置く。
// 「＋ メモ」を外側のタップ・戻る操作・画面の読み込み直し・通信の失敗で閉じても、次に開いたときに戻せるようにする。
// 消すのは、保存できたときと、利用者が「捨てる」を選んだときだけ（黙って捨てない）。画像は控えない（本文と保存先だけ）

export const NOTE_DRAFT_KEY = "yabumi-note-draft";
// 控えを書き換えたことを、同じ画面のほかの部品（「＋ メモ」の印）に知らせる
export const NOTE_DRAFT_EVENT = "yabumi-note-draft";
// これより古い控えは戻さない（30 日）
export const NOTE_DRAFT_DAYS = 30;

export type NoteDraft = { body: string; projectId: string | null; at: number };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseDraft(raw: string | null, now: number = Date.now()): NoteDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<NoteDraft>;
    if (typeof v.body !== "string" || !v.body.trim() || typeof v.at !== "number") return null;
    if (now - v.at > NOTE_DRAFT_DAYS * 86_400_000) return null;
    return { body: v.body.slice(0, MAX_NOTE_CHARS), projectId: typeof v.projectId === "string" ? v.projectId : null, at: v.at };
  } catch {
    return null;
  }
}

// 古すぎる・壊れた控えは、戻さずに消す
export function readDraft(): NoteDraft | null {
  const s = storage();
  const raw = s?.getItem(NOTE_DRAFT_KEY) ?? null;
  const draft = parseDraft(raw);
  if (raw && !draft) {
    try {
      s?.removeItem(NOTE_DRAFT_KEY);
    } catch {
      // 消せなくても、戻さないだけ
    }
  }
  return draft;
}

// 本文が空なら控えを消す
export function writeDraft(body: string, projectId: string | null): void {
  const s = storage();
  if (!s) return;
  try {
    if (body.trim()) s.setItem(NOTE_DRAFT_KEY, JSON.stringify({ body: body.slice(0, MAX_NOTE_CHARS), projectId, at: Date.now() } satisfies NoteDraft));
    else s.removeItem(NOTE_DRAFT_KEY);
  } catch {
    // 容量が足りないなど。控えられなくても書く・保存するは続けられる
  }
  window.dispatchEvent(new Event(NOTE_DRAFT_EVENT));
}

export function clearDraft(): void {
  try {
    storage()?.removeItem(NOTE_DRAFT_KEY);
  } catch {
    // 消せなくても、次に開いたときに「保存していないメモ」として出るだけ
  }
  window.dispatchEvent(new Event(NOTE_DRAFT_EVENT));
}

// 共有で受け取った本文を、書きかけの控えに足す（前の控えを上書きしない）。同じ本文がもう入っていれば足さない
export function mergeShared(draft: string, shared: string): string {
  const d = draft.trim();
  const s = shared.trim();
  if (!s || d.includes(s)) return draft;
  if (!d) return shared;
  return `${draft.trimEnd()}\n\n${shared}`.slice(0, MAX_NOTE_CHARS);
}

// 本文だけで残し、画像を添えられなかったときの知らせ
export const IMAGE_SKIPPED_MESSAGE = "ネタ帳に残しました。画像は添えられなかったので、ネタ帳でメモを直して、もう一度選んでください。";

// 保存できなかったときの知らせ。Next.js の server action が見つからない（画面を開いたあとに yabumi が新しくなった）ときは、読み込み直しを勧める
export function saveFailureMessage(e: unknown, online: boolean): { message: string; reload: boolean } {
  const kept = "書いた内容はこの端末に残しています。";
  if (!online) return { message: `通信がつながっていないので、保存できませんでした。つながってから、もう一度「ネタ帳に保存する」を押してください。${kept}`, reload: false };
  const name = e instanceof Error ? e.name : "";
  const text = e instanceof Error ? e.message : "";
  if (name === "UnrecognizedActionError" || /Server Action .* was not found/.test(text)) {
    return { message: `yabumi が新しくなったため、保存できませんでした。画面を読み込み直してから、もう一度保存してください。${kept}`, reload: true };
  }
  return { message: `保存できませんでした。通信を確かめて、もう一度「ネタ帳に保存する」を押してください。${kept}`, reload: false };
}
