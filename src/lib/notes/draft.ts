import { MAX_NOTE_CHARS } from "./rules";
import { SHARE_CACHE } from "./share";

// 書きかけのメモの控え（ネタ帳。docs/architecture.md の 4.26）。保存するまで、この端末のブラウザ（localStorage）に置く。
// 「＋ メモ」を外側のタップ・戻る操作・画面の読み込み直し・通信の失敗で閉じても、次に開いたときに戻せるようにする。
// 消すのは、保存できたときと、利用者が「捨てる」を選んだとき、ログアウト・退会のときだけ（黙って捨てない）。画像は控えない（本文と保存先だけ）。
// 控えには持ち主（ユーザー ID）を持たせ、いまログインしている人のものだけを戻す（同じブラウザで別の人がログインしても出さない）。
// 持ち主が null の控えは、ログインの前に共有で受け取ったもの（その端末で送ったもの）で、次にログインした人のものにする

export const NOTE_DRAFT_KEY = "yabumi-note-draft";
// 控えを書き換えたことを、同じ画面のほかの部品（「＋ メモ」の印）に知らせる
export const NOTE_DRAFT_EVENT = "yabumi-note-draft";
// これより古い控えは戻さない（30 日）
export const NOTE_DRAFT_DAYS = 30;
// ログインの前に共有で受け取った控え（持ち主なし）を、次にログインした人のものにしてよい間（1 時間）。
// 共有してそのままログインした人の分だけを引き継ぎ、前の人が残していったものを後から来た人に渡さない
export const PENDING_DRAFT_MS = 60 * 60 * 1000;

export type NoteDraft = { body: string; projectId: string | null; at: number; owner: string | null };

// いまログインしている人（NoteDraftOwner が画面を描くときに入れる）。わからないときは null（ログインの前）
let draftOwner: string | null = null;
export function setDraftOwner(userId: string | null): void {
  // サーバーで描くときは入れない（サーバーの変数は、ほかの人の表示と共有される）
  if (typeof window === "undefined") return;
  draftOwner = userId;
}

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
    // 持ち主の欄がない形は、誰のものかわからないので戻さない
    if (!(typeof v.owner === "string" || v.owner === null)) return null;
    if (now - v.at > NOTE_DRAFT_DAYS * 86_400_000) return null;
    return { body: v.body.slice(0, MAX_NOTE_CHARS), projectId: typeof v.projectId === "string" ? v.projectId : null, at: v.at, owner: v.owner };
  } catch {
    return null;
  }
}

// 古すぎる・壊れた控えは、戻さずに消す。ほかの人の控えは戻さない（消しもしない。その人が次にログインしたときに戻る。
// ただし、いまの人が書き始めると上書きする）
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
  return draft ? ownDraft(draft, draftOwner) : null;
}

// 控えを、いまの人に見せてよいか。ログインの前の控え（持ち主 null）は、ログインした人のものにする
export function ownDraft(draft: NoteDraft, owner: string | null, now: number = Date.now()): NoteDraft | null {
  if (draft.owner === owner) return draft;
  if (draft.owner === null && owner && now - draft.at <= PENDING_DRAFT_MS) {
    const claimed = { ...draft, owner };
    try {
      storage()?.setItem(NOTE_DRAFT_KEY, JSON.stringify(claimed));
    } catch {
      // 書けなくても、見せるのはいまの人だけ
    }
    return claimed;
  }
  return null;
}

// いまの人の控えとして書く。本文が空なら控えを消す。いまの人がわからない（ログインの前など）ときは書かない（持ち主のない控えを作らない）
export function writeDraft(body: string, projectId: string | null): void {
  if (!draftOwner) return;
  putDraft(body, projectId, draftOwner);
}

// ログインの前に共有で受け取った本文を、持ち主なしの控えとして書く（/share の ShareStash だけが使う。1 時間だけ引き継げる）
export function writePendingDraft(body: string): void {
  putDraft(body, null, null);
}

function putDraft(body: string, projectId: string | null, owner: string | null): void {
  const s = storage();
  if (!s) return;
  try {
    if (body.trim()) s.setItem(NOTE_DRAFT_KEY, JSON.stringify({ body: body.slice(0, MAX_NOTE_CHARS), projectId, at: Date.now(), owner } satisfies NoteDraft));
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

// ログアウト・退会のとき: この端末の書きかけと、共有で受け取って残していたもの（Cache Storage）を消す（共有の端末で次の人に残さない）。
// 前にメモを残したプロジェクトの覚え（share-receiver の yabumi-note-project）も消す
export async function clearNoteDraftsOnDevice(): Promise<void> {
  const s = storage();
  try {
    s?.removeItem(NOTE_DRAFT_KEY);
    s?.removeItem("yabumi-note-project");
  } catch {
    // 消せなくても、持ち主の違う控えは出さない
  }
  draftOwner = null;
  try {
    if ("caches" in window) await caches.delete(SHARE_CACHE);
  } catch {
    // 同じ
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
