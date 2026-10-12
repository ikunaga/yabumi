// スマホの通知（Web Push）の決まり（docs/architecture.md の 4.28）。画面とサーバーの両方から読む

export const MAX_TITLE_CHARS = 30;
export const MAX_BODY_CHARS = 80;
// 1 人が登録できる端末の数。超えたら古いものから外す
export const MAX_DEVICES_PER_USER = 10;
// 「試しに送る」を続けて押せない間（秒）
export const TEST_PUSH_INTERVAL_SECONDS = 30;
// 届けられない間、push サービスが預かっておく時間（秒）。伴走の声かけは 1 日たてば意味が薄い
export const PUSH_TTL_SECONDS = 24 * 60 * 60;
// 端末 1 つに送るのを待つ時間（ミリ秒）
export const PUSH_TIMEOUT_MS = 10_000;

// 宛先として受け付ける push サービスのホスト（ブラウザが決める。ほかのホストには送らない＝サーバーから任意の URL を呼ばせない）
// Chrome・Edge（Android）・Samsung Internet・Opera は FCM、Safari は Apple、Firefox は Mozilla、Windows の Edge は WNS
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function isAllowedEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.username && !url.password && (url.port === "" || url.port === "443") && PUSH_HOSTS.some((h) => h.test(url.hostname));
}

// 文字数で切り、切ったら「…」を付ける（絵文字などを途中で割らない）
export function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("")}…`;
}

// 押したときに開くのは矢書の中のパスだけ（「//」で始まる別のサイトや、javascript: などは「/」にする）
export function safePath(url: string): string {
  if (!url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) return "/";
  try {
    const u = new URL(url, "https://yabumi.invalid");
    return u.origin === "https://yabumi.invalid" ? `${u.pathname}${u.search}${u.hash}` : "/";
  } catch {
    return "/";
  }
}

// 画面に出す端末の名前（User-Agent から大まかに。合っていなくても困らない）
export function deviceLabel(userAgent: string): string {
  const ua = userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /OPR\//.test(ua)
        ? "Opera"
        : /Firefox|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome|CriOS/.test(ua)
            ? "Chrome"
            : /Safari/.test(ua)
              ? "Safari"
              : "";
  // iPhone・iPad はホーム画面の矢書から登録するので、ブラウザの名前は出さない
  if (os === "iPhone" || os === "iPad") return os;
  if (os && browser) return `${os} の ${browser}`;
  return os || browser || "この端末";
}
