import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppStatusBar } from "@/components/app-status-bar";
import { ServiceWorkerRegister } from "@/components/service-worker";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "yabumi", template: "%s | yabumi" },
  description: "ひとりで売る人のための SNS 運用ツール。何を・いつ・どこに出すかを AI と決めて、複数の SNS にまとめて予約。",
  // OGP 画像などを絶対 URL で出すため。本番は APP_URL（https://yabumi.vercel.app）
  metadataBase: new URL(process.env.APP_URL ?? "https://localhost:3100"),
  openGraph: { siteName: "yabumi", locale: "ja_JP", type: "website" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 切り替えボタンで選んだテーマ。未選択なら属性を付けず OS の設定に従う
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    // data-app-version: この画面の版（4.35）。開いたままの画面が public/version.json と比べ、新しい版に気づく（Next.js の data-dpl-id は読んだあと消えるので、別に持つ）
    <html lang="ja" data-theme={theme} data-app-version={process.env.VERCEL_DEPLOYMENT_ID || undefined} className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <AppStatusBar />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
