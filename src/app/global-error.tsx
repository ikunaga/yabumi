"use client";

import { ErrorFallback } from "@/components/error-fallback";
import "./globals.css";

// ルートのレイアウトそのもので起きたエラー。レイアウトの代わりになるので、html と body をここで書く
// （テーマの cookie は読めないので、OS の明暗の設定に従う）
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <title>エラー | 矢書</title>
        <ErrorFallback error={error} retry={retry} />
      </body>
    </html>
  );
}
