"use client";

import { THEME_COOKIE, type Theme } from "@/lib/theme";

const ONE_YEAR = 60 * 60 * 24 * 365;

function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// ライトとダークを切り替える。何も選んでいない間は OS の設定に従う。
// 表示する文字は CSS（dark: クラス）で出し分けるので、サーバーとブラウザで描画がずれない
export function ThemeToggle({ tone = "default" }: { tone?: "default" | "nav" }) {
  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  }

  const color = tone === "nav" ? "text-nav-fg hover:text-nav-strong" : "text-muted hover:text-fg";

  return (
    <button
      type="button"
      onClick={toggle}
      className={`inline-flex items-center gap-1.5 text-sm whitespace-nowrap hover:underline ${color}`}
    >
      <MoonIcon className="size-3.5 dark:hidden" />
      <span className="dark:hidden">ダーク</span>
      <SunIcon className="hidden size-3.5 dark:inline" />
      <span className="hidden dark:inline">ライト</span>
      <span className="sr-only">表示に切り替える</span>
    </button>
  );
}

function MoonIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M6.2 1.3a6.8 6.8 0 1 0 8.5 8.5A5.6 5.6 0 0 1 6.2 1.3Z" />
    </svg>
  );
}

function SunIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
      <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M3.05 12.95l1.13-1.13M11.82 4.18l1.13-1.13" />
    </svg>
  );
}
