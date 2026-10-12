// 短縮リンクのホストとパスの見分け（docs/architecture.md の 4.22、決定 D20・D28）。proxy から呼ぶ
// - SHORT_LINK_BASE_URL のホスト（go.yabumi.app）で開かれたら: /<code> を転送の処理に回す。/ だけなら矢書のトップへ
// - どのホストでも /go/<code>（短縮リンクのホストの DNS ができる前、ローカル）: 転送の処理に回す（ログインの確認を飛ばす）
// - 矢書のものではないホスト（利用者のドメイン。例 go.example.com）で開かれたら: /<code> を転送の処理に回し、
//   ほかのパスは 404 にする（利用者のドメインの下に、ログインなど矢書の画面を出さない）
// 転送の処理は /go/<code>/<開いたホスト>（src/app/go/[code]/[host]/route.ts）。ホストは proxy が毎回付け直す（外から入れた値は使わない）。
// 矢書のホストは "_"。利用者のドメインなら、そのドメインのプロジェクトのリンクだけを開く。
// （ホストをヘッダーで渡すと、rewrite のあとの処理に届かないことがあったので、パスに入れる。2026-10-12）

import { LINK_CHECK_BODY, LINK_CHECK_PATH } from "./domain-rules";
import { CODE_PATTERN } from "./rules";

// 矢書のホストを表す、転送の処理のパスの最後の部分
export const YABUMI_HOST_SEGMENT = "_";

export type ShortLinkRoute =
  | { type: "rewrite"; pathname: string }
  | { type: "redirect"; url: URL }
  | { type: "respond"; status: number; body: string }
  | null;

function parse(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function hostnameOf(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, "").replace(/\.+$/, "");
}

// 矢書のホストか（APP_URL とそのサブドメイン、SHORT_LINK_BASE_URL、vercel.app、ローカル）。
// APP_URL がないときは、すべて矢書のホストとして扱う（利用者のドメインの扱いをしない）
export function isYabumiHost(hostname: string, env: { appUrl?: string; shortLinkBaseUrl?: string }): boolean {
  const host = hostnameOf(hostname);
  const app = parse(env.appUrl)?.hostname.toLowerCase();
  if (!app) return true;
  const short = parse(env.shortLinkBaseUrl)?.hostname.toLowerCase();
  if (host === app || host.endsWith(`.${app}`) || host === short) return true;
  return host.endsWith(".vercel.app") || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]";
}

// 転送の処理のパス。利用者のドメインはドメインの形の文字だけ（そうでなければ、どのリンクも開かない名前にする）
function goPath(code: string, yabumi: boolean, host: string): string {
  const segment = yabumi ? YABUMI_HOST_SEGMENT : /^[a-z0-9.-]+$/.test(hostnameOf(host)) ? hostnameOf(host) : "invalid";
  return `/go/${encodeURIComponent(code)}/${segment}`;
}

// host: 届いたリクエストの Host（ヘッダー）。URL のホストはサーバーの側で決まることがある（ローカルの next dev では待ち受けのアドレス）ので、
// 利用者が開いたホストはヘッダーで見る。なければ URL のホスト
export function shortLinkRoute(url: URL, shortLinkBaseUrl?: string, appUrl?: string, host: string = url.host): ShortLinkRoute {
  const yabumi = isYabumiHost(host, { appUrl, shortLinkBaseUrl });
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "go" && segments[1]) return { type: "rewrite", pathname: goPath(decodeURIComponent(segments[1]), yabumi, host) };
  if (segments[0] === "go") return { type: "respond", status: 404, body: "このリンクは見つからないか、使われていません。" };
  const code = url.pathname.replace(/^\/+|\/+$/g, "");
  const short = parse(shortLinkBaseUrl);
  if (short && host.toLowerCase() === short.host) {
    if (!code) return { type: "redirect", url: new URL(appUrl ?? `${url.protocol}//${url.host}`) };
    return { type: "rewrite", pathname: goPath(code, true, host) };
  }
  if (yabumi) return null;
  // 利用者のドメイン
  if (url.pathname === LINK_CHECK_PATH) return { type: "respond", status: 200, body: LINK_CHECK_BODY };
  if (CODE_PATTERN.test(code)) return { type: "rewrite", pathname: goPath(code, false, host) };
  return { type: "respond", status: 404, body: "このアドレスは短縮リンク用です。リンクが正しいか確かめてください。" };
}
