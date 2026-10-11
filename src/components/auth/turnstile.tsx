"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, opts: { sitekey: string; language?: string; theme?: "auto" }) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// ロボットによる大量の登録・ログインを防ぐ確認（Cloudflare Turnstile。無料）。docs/architecture.md の 4.16。
// NEXT_PUBLIC_TURNSTILE_SITE_KEY がないとき（ローカルなど）は何も出さない。
// 確認が済むと、フォームに cf-turnstile-response という隠しの欄が入り、送信と一緒にサーバーへ届く。
// トークンは 1 回しか使えないので、送信の結果が返るたびに（resetKey が変わるたびに）確認をやり直す
export function Turnstile({ resetKey }: { resetKey: unknown }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  function render() {
    if (!siteKey || !box.current || !window.turnstile || widget.current) return;
    widget.current = window.turnstile.render(box.current, { sitekey: siteKey, language: "ja", theme: "auto" });
  }

  useEffect(() => {
    render();
    return () => {
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (widget.current) window.turnstile?.reset(widget.current);
  }, [resetKey]);

  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={render} />
      <div ref={box} className="min-h-[65px]" />
    </>
  );
}
