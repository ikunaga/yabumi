import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ServiceWorkerRegister } from "@/components/service-worker";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "矢書（やぶみ）", template: "%s | 矢書" },
  description: "ひとりで売る人のための SNS 運用ツール。何を・いつ・どこに出すかを AI と決めて、複数の SNS にまとめて予約。",
  // OGP 画像などを絶対 URL で出すため。本番は APP_URL（https://yabumi.vercel.app）
  metadataBase: new URL(process.env.APP_URL ?? "https://localhost:3100"),
  openGraph: { siteName: "矢書（やぶみ）", locale: "ja_JP", type: "website" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 切り替えボタンで選んだテーマ。未選択なら属性を付けず OS の設定に従う
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang="ja" data-theme={theme} className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
