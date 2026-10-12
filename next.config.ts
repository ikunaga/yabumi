import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発時は 127.0.0.1 で開く（Supabase のリダイレクト先と揃えるため）
  allowedDevOrigins: ["127.0.0.1"],
  // service worker（ネタ帳の共有の受け口。4.26）は、いつも新しいものを読む
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] }];
  },
};

export default nextConfig;
