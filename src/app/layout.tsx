import type { Metadata } from "next";
import { Zen_Kaku_Gothic_New } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

// 見出し用。日本語は字ごとに分割配信されるので、使う字だけ読み込まれる
const zenKaku = Zen_Kaku_Gothic_New({
  weight: ["500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-zen-kaku",
});

export const metadata: Metadata = {
  title: { default: "矢書（やぶみ）", template: "%s | 矢書" },
  description: "個人開発者のための、SNS 運用をまるごと任せられるツール",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 切り替えボタンで選んだテーマ。未選択なら属性を付けず OS の設定に従う
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang="ja" data-theme={theme} className={`${zenKaku.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
