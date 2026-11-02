import { unstable_rethrow } from "next/navigation";

// サーバーの処理（server action）を画面から呼んで失敗したときの扱い（docs/architecture.md の 4.35）。
// 1. yabumi が新しくなった（画面を開いたあとにデプロイがあり、古い画面の server action や JS が見つからない）
// 2. 通信が切れている
// 3. そのほか
// どれも、入力は残したまま、目立つ形で理由を出す。1 のときは「読み込み直す」を出し、画面の上の帯にも知らせる（STALE_EVENT）

// 画面の上の帯（AppStatusBar）に「新しい版があります」を出させる知らせ
export const STALE_EVENT = "yabumi:stale";

export type ActionFailure = { message: string; stale: boolean };

// 古い画面のまま呼んだときの失敗か。server action が見つからない（UnrecognizedActionError）か、JS の読み込みに失敗した（ChunkLoadError）
export function isStaleError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "UnrecognizedActionError" || e.name === "ChunkLoadError") return true;
  return /Server Action .* was not found|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/.test(e.message);
}

export const STALE_MESSAGE = "yabumi が新しくなったため、保存や送信ができませんでした。画面を読み込み直してから、もう一度押してください。";
export const OFFLINE_MESSAGE = "通信がつながっていないので、保存や送信ができませんでした。つながってから、もう一度押してください。";
export const FAILED_MESSAGE = "保存や送信ができませんでした。通信を確かめて、もう一度押してください。";

// 失敗の理由と、知らせの文。kept を渡すと「入力は残しています」などを後ろに足す
export function actionFailure(e: unknown, online: boolean, kept = ""): ActionFailure {
  const tail = kept;
  if (!online) return { message: `${OFFLINE_MESSAGE}${tail}`, stale: false };
  if (isStaleError(e)) return { message: `${STALE_MESSAGE}${tail}`, stale: true };
  return { message: `${FAILED_MESSAGE}${tail}`, stale: false };
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

// 古い画面だとわかったら、画面の上の帯にも出す
export function announceStale(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(STALE_EVENT));
}

// 画面から server action を呼んで、失敗を ActionFailure にする（Next.js の画面の移動・redirect などの知らせは、そのまま投げ直す）。
// 通信が切れているときは呼ばない（Next.js は、つながるまで待ち続け、押しても何も起きないように見えるため）
export async function callAction<T>(run: () => Promise<T>, kept = ""): Promise<{ ok: true; value: T } | { ok: false; failure: ActionFailure }> {
  if (!isOnline()) return { ok: false, failure: actionFailure(null, false, kept) };
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    unstable_rethrow(e);
    console.error("[callAction]", e);
    const failure = actionFailure(e, isOnline(), kept);
    if (failure.stale) announceStale();
    return { ok: false, failure };
  }
}

// useActionState に渡す action を包む。失敗したら toState で、その画面の「エラーの状態」にする（エラーの画面に飛ばさない）
export function guardAction<S>(action: (prev: S, data: FormData) => Promise<S>, toState: (message: string, data: FormData, prev: S) => S) {
  return async (prev: S, data: FormData): Promise<S> => {
    const r = await callAction(() => action(prev, data));
    return r.ok ? r.value : toState(r.failure.message, data, prev);
  };
}

// guardAction の toState でよく使う形: { error }
export function errorState<S extends { error?: string }>(message: string): S {
  return { error: message } as S;
}

// フォームの文字の欄を、送ったときの値のまま返す（失敗したときに、画面に戻す用）
export function formValues(data: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of data.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) values[k] = v;
  return values;
}
