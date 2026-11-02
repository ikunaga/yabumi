"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { STALE_EVENT } from "@/lib/client-errors";

// 画面のいちばん上に出す小さな帯（docs/architecture.md の 4.35）。押す前に気づけるように、次の 2 つを知らせる。
// - 通信が切れている（保存や送信は、つながるまで進まない）
// - yabumi の新しい版がある（開いたままの画面が古い。保存や送信が失敗することがあるので、読み込み直してもらう）
// 新しい版は、画面に戻ってきたとき・30 分ごとに public/version.json（静的なファイル。関数は動かない）を読み、自分の版（<html data-app-version>）と比べる。
// 保存や送信が「見つからない」で失敗したときも出す（STALE_EVENT）。ローカルでは版の名前がないので比べない

const CHECK_EVERY_MS = 30 * 60 * 1000;

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function AppStatusBar() {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const onStale = () => setStale(true);
    window.addEventListener(STALE_EVENT, onStale);
    const mine = document.documentElement.dataset.appVersion;
    if (!mine) return () => window.removeEventListener(STALE_EVENT, onStale);

    let last = 0;
    async function check() {
      if (document.visibilityState !== "visible" || navigator.onLine === false) return;
      // 戻ってくるたびに読まない（1 分あける）
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      try {
        const res = await fetch("/version.json", { cache: "no-store" });
        if (!res.ok) return;
        const v = (await res.json()) as { id?: unknown };
        if (typeof v.id === "string" && v.id && v.id !== mine) setStale(true);
      } catch {
        // 読めなければ、次の機会に
      }
    }
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    const timer = setInterval(onVisible, CHECK_EVERY_MS);
    return () => {
      window.removeEventListener(STALE_EVENT, onStale);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      clearInterval(timer);
    };
  }, []);

  if (online && !stale) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-pop px-4 pt-[calc(env(safe-area-inset-top)+8px)] pb-2 text-center text-[13px] leading-[1.6] text-on-pop"
    >
      {!online ? (
        <span>
          <b>通信がつながっていません。</b>つながるまで、保存や送信は進みません。書いている途中なら、画面を閉じずに待ってください。
        </span>
      ) : (
        <>
          <span>
            <b>yabumi の新しい版があります。</b>このままだと保存や送信ができないことがあります。書きかけはコピーしてから、読み込み直してください（投稿をつくるの本文・設計・メモは、読み込み直しても戻ります）。
          </span>
          <button type="button" onClick={() => window.location.reload()} className="shrink-0 rounded-full border border-current px-3 py-0.5 text-[13px] font-semibold hover:bg-on-pop/10">
            読み込み直す
          </button>
        </>
      )}
    </div>
  );
}
