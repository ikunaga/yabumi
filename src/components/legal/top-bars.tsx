"use client";

import { type ReactNode, useEffect, useRef } from "react";

// ログイン後の画面の上に出す帯（同意の帯・規約の変更のお知らせ）をまとめる枠。
// 帯の高さを CSS の変数 --app-top-bars に入れ、サイドバー（画面の高さに合わせて上に貼りつく）がその分だけ縮むようにする。
// 帯がなければ 0（帯を閉じたら測り直す）
export function TopBars({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--app-top-bars", `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--app-top-bars");
    };
  }, []);
  return <div ref={ref}>{children}</div>;
}
