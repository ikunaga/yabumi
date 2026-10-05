import type { MetadataRoute } from "next";

// ホーム画面に追加したときの名前とアイコン（アイコンは scripts/build-brand-assets.mjs で作る）
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "矢書（やぶみ）",
    short_name: "矢書",
    description: "個人開発者のための、SNS 運用をまるごと任せられるツール",
    start_url: "/projects",
    display: "standalone",
    // トークンの bg（生成り）と primary（藍）
    background_color: "#f2f2ee",
    theme_color: "#23406e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
