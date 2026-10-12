// 矢書の service worker。受け持つのは次の 2 つだけ。ほかの通信には手を出さない（オフラインの保存もしない）
// - ほかのアプリからの「共有」（manifest の share_target。docs/architecture.md の 4.26）。
//   受けたもの（本文と画像 1 枚）はサーバーに送らず、ブラウザの中（Cache Storage）に置いてから /share を開く。
//   ログインしていなくても、ログインのあとで /share が続きを読める
// - スマホの通知（Web Push。4.28）。受けたら通知を出し、押したら矢書の中のその画面を開く
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

// ===== スマホの通知（Web Push。4.28） =====
// 中身はサーバー（src/lib/push/send.ts）が { title, body, url, tag } の JSON で送る。
// 受けたら必ず通知を出す（Safari は、通知を出さないことが続くと購読を止める）
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // 読めなかったときは、決まった文で出す
  }
  const title = typeof data.title === "string" && data.title ? data.title : "矢書からのお知らせ";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: safePath(data.url) },
    lang: "ja",
  };
  if (typeof data.tag === "string" && data.tag) {
    options.tag = data.tag;
    // 同じ tag で置き換えたときも、もう一度知らせる
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

// 押したら、矢書の画面がすでに開いていればそこに移って開き直し、なければ新しく開く
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (same) {
        try {
          await same.focus();
          await same.navigate(url);
          return;
        } catch {
          // 移れなかったときは、新しく開く
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// ブラウザが購読を新しくしたとき（Firefox など）。新しい宛先をサーバーに知らせる（ログインの cookie で本人を確かめる）
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const key = old && old.options && old.options.applicationServerKey;
      const next = event.newSubscription || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
      if (!next) return;
      await fetch("/api/push/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldEndpoint: old ? old.endpoint : null, subscription: next.toJSON() }),
      });
    })().catch(() => {}),
  );
});

// 開くのは矢書の中のパスだけ（src/lib/push/rules.ts の safePath と同じ決まり）
function safePath(url) {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) return "/";
  try {
    const u = new URL(url, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/";
  } catch {
    return "/";
  }
}
