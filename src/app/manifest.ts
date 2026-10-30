import type { MetadataRoute } from "next";

// ホーム画面に追加したときの名前とアイコン（アイコンは scripts/build-brand-assets.mjs で作る）
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "矢書（やぶみ）",
    short_name: "矢書",
    description: "個人開発者のための、SNS 運用をまるごと任せられるツール",
    start_url: "/projects",
    display: "standalone",
    // トークンの bg（うすい灰）と、上の帯の地（白）
    background_color: "#f6f6f7",
    theme_color: "#ffffff",
    // ほかのアプリの「共有」から、ネタ帳のメモにする（4.26。Android の Chrome など。iOS の Safari は対応していない）。
    // service worker（public/sw.js）が受けて、ブラウザの中に置いてから /share を開く
    share_target: {
      action: "/share/receive",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "image", accept: ["image/*"] }] },
    },
    // ホーム画面のアイコンを長押ししたときの近道
    shortcuts: [{ name: "ネタ帳にメモを残す", short_name: "メモ", url: "/share" }],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
