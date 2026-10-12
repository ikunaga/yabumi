"use client";

import { useEffect } from "react";

// service worker（public/sw.js）を登録する。ほかのアプリからの「共有」をネタ帳で受けるため（4.26）と、スマホの通知を受けるため（4.28）。ほかの通信には手を出さない
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.error("[sw] 登録できませんでした", e));
  }, []);
  return null;
}
