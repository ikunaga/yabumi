// 矢書の service worker（docs/architecture.md の 4.26）。ほかのアプリからの「共有」（manifest の share_target）だけを受ける。
// 受けたもの（本文と画像 1 枚）はサーバーに送らず、ブラウザの中（Cache Storage）に置いてから /share を開く。
// ログインしていなくても、ログインのあとで /share が続きを読める。ほかの通信には手を出さない（オフラインの保存もしない）
const SHARE_CACHE = "yabumi-share";
const SHARE_CACHE_TEXT = "/share/pending/text";
const SHARE_CACHE_IMAGE = "/share/pending/image";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/share/receive") return;
  event.respondWith(receiveShare(event.request));
});

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const str = (k) => {
      const v = form.get(k);
      return typeof v === "string" ? v : "";
    };
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(
      SHARE_CACHE_TEXT,
      new Response(JSON.stringify({ title: str("title"), text: str("text"), url: str("url"), at: Date.now() }), { headers: { "Content-Type": "application/json" } }),
    );
    const file = form.getAll("image").find((v) => typeof v !== "string" && v.size > 0 && v.size <= MAX_IMAGE_BYTES && v.type.startsWith("image/"));
    if (file) await cache.put(SHARE_CACHE_IMAGE, new Response(file, { headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name || "image") } }));
    else await cache.delete(SHARE_CACHE_IMAGE);
  } catch {
    // 読めなかったときは、空のメモとして開く
  }
  return Response.redirect("/share", 303);
}
