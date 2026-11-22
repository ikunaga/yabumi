import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発時は 127.0.0.1 で開く（Supabase のリダイレクト先と揃えるため）
  allowedDevOrigins: ["127.0.0.1"],
  // サーバーで画像に見出しを描く（docs/design/auto-sample-image.md の 11.）。@napi-rs/canvas はネイティブのモジュールなので束ねない。
  // 書体（src/server-fonts/、約 49MB）は、描く処理を呼ぶ関数（自動の投稿のジョブ・自動の投稿の画面の操作・運営者の試し）にだけ入れる
  serverExternalPackages: ["@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/jobs/auto-post": ["./src/server-fonts/**/*"],
    "/api/admin/render-check": ["./src/server-fonts/**/*"],
    "/projects/\\[id\\]/auto/**/*": ["./src/server-fonts/**/*"],
  },
  // 版の名前（docs/architecture.md の 4.35）。古い画面から新しいサーバーへ画面を移ると、Next.js が読み込み直しにする。
  // ローカルでは付けない（開いたままの画面が新しい版に気づく仕組みは、src/app/layout.tsx の data-app-version と public/version.json）
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || undefined,
  // service worker（ネタ帳の共有の受け口。4.26）と版の名前（4.35）は、いつも新しいものを読む
  async headers() {
    return [
      // セキュリティのヘッダー（セキュリティ確認 2026-11-21 の L3）。どの応答にも付ける。
      // X-Frame-Options: ほかのサイトに画面を埋め込ませない（yabumi は自分の画面も iframe に入れていない）。
      // Referrer-Policy: ほかのサイトへは、どのページから来たかを送らず、オリジンだけを送る（短縮リンクの転送先も同じ）。
      // X-Content-Type-Options: Content-Type と違う種類として読ませない。CSP は別に決める
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
      // いまの版の名前（4.35）。開いたままの画面が、いつも新しいものを読む
      { source: "/version.json", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
