// 音声入力（ブラウザの音声認識 Web Speech API。日本語）。投稿をつくるの本文・SNS ごとの文面・ネタ帳のメモ・AI と相談の入力で使う。
// 音声を文字にするのはブラウザの仕組み（Chrome は Google、Safari は Apple のサーバー）で、yabumi のサーバーは音声も途中の文字も受け取らない。
// 費用はかからない。Firefox などは音声認識がないので、ボタンを押せない状態にして理由を出す。
// 画面の部品は src/components/ui/voice-input.tsx。ここは画面に依存しない部分（テストできるように）

// TypeScript の DOM の型に SpeechRecognition がないので、使うところだけ書く
export type RecognitionAlternative = { transcript: string };
export type RecognitionResult = { isFinal: boolean; length: number; [index: number]: RecognitionAlternative };
export type RecognitionResultEvent = { resultIndex: number; results: { length: number; [index: number]: RecognitionResult } };
export type RecognitionErrorEvent = { error: string };

export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type RecognitionCtor = new () => Recognition;

// 使えるブラウザなら作り方を返す（Chrome・Edge は SpeechRecognition か webkitSpeechRecognition、Safari は webkitSpeechRecognition）
export function getRecognitionCtor(w: unknown = typeof window === "undefined" ? undefined : window): RecognitionCtor | null {
  if (!w || typeof w !== "object") return null;
  const g = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

// 話した言葉を、いまのカーソルの位置（選んでいる文字があれば、それと置き換え）に足す。
// maxLength（0 以下は上限なし）を超える分は切る。戻り値の caret は、足した言葉のすぐあと
export function insertAtCursor(value: string, start: number, end: number, text: string, maxLength = 0): { value: string; caret: number } {
  const s = Math.max(0, Math.min(start, value.length));
  const e = Math.max(s, Math.min(end, value.length));
  let add = text;
  if (maxLength > 0) {
    // textarea の maxLength と同じ数え方（UTF-16 の単位）。絵文字などの途中では切らない
    const room = Math.max(0, maxLength - (value.length - (e - s)));
    const chars = Array.from(add);
    while (chars.join("").length > room) chars.pop();
    add = chars.join("");
  }
  return { value: value.slice(0, s) + add + value.slice(e), caret: s + add.length };
}

export type VoiceErrorKind = "denied" | "no_mic" | "no_speech" | "network" | "other";

export function voiceErrorKind(code: string): VoiceErrorKind | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "audio-capture":
      return "no_mic";
    case "no-speech":
      return "no_speech";
    case "network":
      return "network";
    // 自分で止めたとき（abort）は知らせない
    case "aborted":
      return null;
    default:
      return "other";
  }
}

export const VOICE_ERROR_MESSAGES: Record<VoiceErrorKind, string> = {
  denied:
    "マイクを使うのが許可されていません。アドレス欄の左のマーク（鍵など）を押してマイクを「許可」にしてから、もう一度マイクのボタンを押してください。スマホは、設定のアプリ（ブラウザ）の欄でマイクを許可します。",
  no_mic: "マイクが見つかりませんでした。マイクがつながっているか確かめてください。",
  no_speech: "声が聞き取れませんでした。マイクに近づいて、もう一度押してください。",
  network: "音声を文字にする仕組み（ブラウザの会社のサーバー）につながりませんでした。ネットの接続を確かめるか、キーボードで入れてください。",
  other: "音声入力が止まりました。もう一度押すか、キーボードで入れてください。",
};

// 1 回の聞き取り。確定した言葉は onFinal、途中の言葉は onInterim（表示だけ）、終わったら onEnd（エラーなら種類つき）
export function startVoiceSession(
  Ctor: RecognitionCtor,
  handlers: { onFinal: (text: string) => void; onInterim: (text: string) => void; onEnd: (error: VoiceErrorKind | null) => void },
): { stop: () => void; abort: () => void } {
  const rec = new Ctor();
  rec.lang = "ja-JP";
  rec.continuous = true;
  rec.interimResults = true;
  let error: VoiceErrorKind | null = null;
  let ended = false;
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const t = r[0]?.transcript ?? "";
      if (r.isFinal) {
        if (t.trim()) handlers.onFinal(t.trim());
      } else interim += t;
    }
    handlers.onInterim(interim);
  };
  rec.onerror = (e) => {
    error = voiceErrorKind(e.error) ?? error;
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    handlers.onInterim("");
    handlers.onEnd(error);
  };
  try {
    rec.start();
  } catch {
    // すでに動いているなど。終わったことにする
    ended = true;
    handlers.onEnd("other");
  }
  return {
    stop: () => rec.stop(),
    abort: () => {
      rec.onresult = null;
      rec.abort();
    },
  };
}
