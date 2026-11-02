import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発時は 127.0.0.1 で開く（Supabase のリダイレクト先と揃えるため）
  allowedDevOrigins: ["127.0.0.1"],
  // 版の名前（docs/architecture.md の 4.35）。古い画面から新しいサーバーへ画面を移ると、Next.js が読み込み直しにする。
  // ローカルでは付けない（開いたままの画面が新しい版に気づく仕組みは、src/app/layout.tsx の data-app-version と public/version.json）
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || undefined,
  // service worker（ネタ帳の共有の受け口。4.26）と版の名前（4.35）は、いつも新しいものを読む
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
      // いまの版の名前（4.35）。開いたままの画面が、いつも新しいものを読む
      { source: "/version.json", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
