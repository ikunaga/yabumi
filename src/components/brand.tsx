import Link from "next/link";

// ロゴ: 矢のマーク ＋ 小文字の「yabumi」（オーナーの決定 2026-10-30、見本は docs/design/new_design/logo/ の D ミニマル）。
// 画面の文言の名前は「矢書」のまま。ロゴだけ yabumi にする。色はロゴの墨（--logo）
export function Brand({ href = "/", size = "md" }: { href?: string; size?: "sm" | "md" | "lg" }) {
  const look = {
    sm: { mark: "h-[15px]", text: "text-[18px]", gap: "gap-2" },
    md: { mark: "h-[18px]", text: "text-[21px]", gap: "gap-2.5" },
    lg: { mark: "h-[22px]", text: "text-[26px]", gap: "gap-3" },
  }[size];

  return (
    <Link
      href={href}
      className={`inline-flex shrink-0 items-center whitespace-nowrap text-logo hover:no-underline ${look.gap}`}
      aria-label="矢書（やぶみ） トップへ"
    >
      <LogoMark className={`${look.mark} w-auto`} />
      {/* 字面の中央をマークに合わせるため、行の高さを 1 にして少し上げる（小文字は下に寄って見える） */}
      <span aria-hidden className={`relative -top-px leading-none font-bold tracking-[0.06em] ${look.text}`}>
        yabumi
      </span>
    </Link>
  );
}

// 矢のマーク。線だけで描き、色は文字の色（currentColor）。16px でも形が分かる太さ（見本の線幅 7 / 幅 70）
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="10 22 70 56" className={className} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
      <path d={LOGO_MARK_PATH} />
    </svg>
  );
}

// マークの形（viewBox は 10 22 70 56）。scripts/build-brand-assets.mjs のアイコンも同じ形で描く
export const LOGO_MARK_PATH = "M14 26 L38 50 L14 74 M38 50 L72 50 M60 36 L76 50 L60 64";
