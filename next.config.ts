import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発時は 127.0.0.1 で開く（Supabase のリダイレクト先と揃えるため）
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
