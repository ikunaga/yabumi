// 短縮リンクのホストとパスの見分け（docs/architecture.md の 4.22、決定 D20）。proxy から呼ぶ
// - SHORT_LINK_BASE_URL のホスト（go.yabumi.app）で開かれたら: /<code> を /go/<code> に回す。/ だけなら矢書のトップへ
// - <APP_URL>/go/<code>（短縮リンクのホストの DNS ができる前、ローカル）: そのまま通す（ログインの確認を飛ばす）

export type ShortLinkRoute = { type: "rewrite"; url: URL } | { type: "redirect"; url: URL } | { type: "pass" } | null;

export function shortLinkRoute(url: URL, shortLinkBaseUrl?: string, appUrl?: string): ShortLinkRoute {
  if (url.pathname === "/go" || url.pathname.startsWith("/go/")) return { type: "pass" };
  if (!shortLinkBaseUrl) return null;
  let shortHost: string;
  try {
    shortHost = new URL(shortLinkBaseUrl).host;
  } catch {
    return null;
  }
  if (url.host !== shortHost) return null;
  const code = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!code) return { type: "redirect", url: new URL(appUrl ?? `${url.protocol}//${url.host}`) };
  const to = new URL(url.toString());
  to.pathname = `/go/${code}`;
  return { type: "rewrite", url: to };
}
