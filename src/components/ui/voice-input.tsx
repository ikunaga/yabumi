"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { HelpTip } from "./help";
import { getRecognitionCtor, insertAtCursor, startVoiceSession, VOICE_ERROR_MESSAGES, type VoiceErrorKind } from "@/lib/voice/speech";

const noopSubscribe = () => () => {};

// 音声入力のボタン（マイク）。押すと聞き取り、話した言葉を入力欄のいまのカーソルの位置に足す。もう一度押すと止める。
// 音声を文字にするのはブラウザの仕組みで、yabumi は音声を受け取らない（src/lib/voice/speech.ts）。
// 使い方: 入力欄に ref を付け、<VoiceInputButton target={ref} onChange={(v) => setText(v)} label="本文" />。
// スマホはキーボードのマイクでも入れられるので、ボタンは小さく、欄のすみに置く
export function VoiceInputButton({
  target,
  onChange,
  label,
  className = "",
}: {
  target: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  onChange: (value: string) => void;
  // 何に入れるか（読み上げ用。「本文」「メモ」など）
  label: string;
  className?: string;
}) {
  const support = useSyncExternalStore(
    noopSubscribe,
    () => (getRecognitionCtor() ? "yes" : "no"),
    () => "unknown",
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<VoiceErrorKind | null>(null);
  const session = useRef<ReturnType<typeof startVoiceSession> | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // 画面を離れたら止める
  useEffect(() => () => session.current?.abort(), []);

  const insert = (text: string) => {
    const el = target.current;
    if (!el) return;
    const { value, caret } = insertAtCursor(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, text, el.maxLength);
    onChangeRef.current(value);
    // React が値を入れ替えたあとに、カーソルを足した言葉のあとへ（続けて話すと、その続きに入る）
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        // type によっては選べない。値は入っているので何もしない
      }
    });
  };

  const toggle = () => {
    if (listening) {
      session.current?.stop();
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setError(null);
    setListening(true);
    session.current = startVoiceSession(Ctor, {
      onFinal: insert,
      onInterim: setInterim,
      onEnd: (e) => {
        session.current = null;
        setListening(false);
        setError(e);
      },
    });
  };

  const unsupported = support === "no";

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={support !== "yes"}
          aria-pressed={listening}
          title={unsupported ? "このブラウザでは音声入力を使えません" : listening ? "音声入力を止める" : "声で入れる"}
          className={[
            "inline-flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors duration-[120ms] max-sm:size-9",
            listening ? "border-primary bg-primary text-on-primary" : "border-input bg-surface text-muted hover:border-muted hover:text-fg",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input disabled:hover:text-muted",
          ].join(" ")}
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="7" y="2.5" width="6" height="10" rx="3" />
            <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
          </svg>
          <span className="sr-only">{listening ? `${label}の音声入力を止める` : `${label}を声で入れる`}</span>
        </button>
        {unsupported && (
          <HelpTip label="音声入力">
            このブラウザ（Firefox など）には、声を文字にする仕組みがないため使えません。Chrome・Edge・Safari なら使えます。スマホは、キーボードのマイクのボタンからも声で入れられます。
          </HelpTip>
        )}
        <span aria-live="polite" className="min-w-0 truncate text-[13px] text-muted">
          {listening && (
            <>
              <span className="font-semibold text-signal">●</span> 聞き取り中{interim ? `：${interim}` : "（もう一度押すと止まります）"}
            </>
          )}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-[13px] font-semibold text-danger">
          {VOICE_ERROR_MESSAGES[error]}
        </p>
      )}
    </div>
  );
}
