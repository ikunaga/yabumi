"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { STALE_EVENT } from "@/lib/client-errors";
import { getReloadSaver, newReloadToken, savedWith, subscribeReloadSaver } from "@/lib/reload-saver";

// 画面のいちばん上に出す小さな帯（docs/architecture.md の 4.35）。押す前に気づけるように、次の 2 つを知らせる。
// - 通信が切れている（保存や送信は、つながるまで進まない）
// - yabumi の新しい版がある（開いたままの画面が古い。保存や送信が失敗することがあるので、読み込み直してもらう）
// 新しい版は、画面に戻ってきたとき・30 分ごとに public/version.json（静的なファイル。関数は動かない）を読み、自分の版（<html data-app-version>）と比べる。
// 保存や送信が「見つからない」で失敗したときも出す（STALE_EVENT）。ローカルでは版の名前がないので比べない
// 置き場所: 画面の上に重ねず、ページのいちばん上に並べる（前は上に留めて重ね、スクロールしても入力欄を覆った。2026-11-18 PMO の付箋 16）。
// 投稿をつくるで書きかけがあるときは「下書きに保存して読み込み直す」を出す（src/lib/reload-saver.ts）

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
  const saver = useSyncExternalStore(subscribeReloadSaver, getReloadSaver, () => null);
  // 下書きに保存している（保存できたら、移った先で読み込み直す）・保存できなかった
  const [saving, setSaving] = useState<"saving" | "failed" | null>(null);
  // この保存の合図（移った先の URL に付く）
  const [token, setToken] = useState("");

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

  // 保存したら、保存した下書きの画面に移る。移ったのを見てから読み込み直す（30 秒たっても移らなければやめる）
  useEffect(() => {
    if (saving !== "saving") return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (savedWith(window.location.href, token)) {
        clearInterval(timer);
        window.location.reload();
      } else if (Date.now() - started > 30_000) {
        clearInterval(timer);
        setSaving("failed");
      }
    }, 300);
    return () => clearInterval(timer);
  }, [saving, token]);

  function saveThenReload() {
    if (!saver) return window.location.reload();
    const t = newReloadToken();
    setToken(t);
    setSaving("saving");
    saver(t, () => setSaving("failed"));
  }

  if (online && !stale) return null;
  const button = "shrink-0 rounded-full border border-current px-3 py-0.5 text-[13px] font-semibold hover:bg-on-pop/10 disabled:opacity-60";
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-pop px-4 pt-[calc(env(safe-area-inset-top)+6px)] pb-1.5 text-center text-[13px] leading-[1.6] text-on-pop"
    >
      {!online ? (
        <span>
          <b>通信がつながっていません。</b>つながるまで、保存や送信は進みません。書いている途中なら、画面を閉じずに待ってください。
        </span>
      ) : (
        <>
          <span>
            <b>yabumi の新しい版があります。</b>
            {saving === "failed"
              ? "下書きに保存できませんでした。本文は読み込み直しても戻ります。画像などは、コピーや控えを取ってから読み込み直してください。"
              : saver
                ? "書きかけを下書きに保存してから、読み込み直してください。"
                : "保存や送信ができないことがあるので、読み込み直してください（書きかけの投稿の本文・設計・メモは戻ります）。"}
          </span>
          {saver && saving !== "failed" ? (
            <button type="button" onClick={saveThenReload} disabled={saving === "saving"} className={button}>
              {saving === "saving" ? "保存しています…" : "下書きに保存して読み込み直す"}
            </button>
          ) : (
            <button type="button" onClick={() => window.location.reload()} className={button}>
              読み込み直す
            </button>
          )}
        </>
      )}
    </div>
  );
}
