// 短縮リンクに使う利用者のドメインの決まり（F07、決定 D28。docs/architecture.md の 4.22）。画面とサーバーの両方から読む

// ドメインの数の決まり。Vercel Hobby は 1 プロジェクトにドメイン 50 まで（https://vercel.com/docs/limits、2026-10-12 確認）。
// 矢書の分（yabumi.app・www・go・vercel.app）を除いて、利用者の分は 40 まで。LINK_DOMAIN_LIMIT で変えられる（Pro にしたら上げる）
export const DEFAULT_LINK_DOMAIN_LIMIT = 40;
// 上限のこの割合に達したら、運営者に知らせる
export const LINK_DOMAIN_WARN_RATIO = 0.8;
// 1 利用者が 1 日に足せる回数（足しては外すをくり返して Vercel の API を使い込まれないように）
export const LINK_DOMAIN_DAILY_ATTEMPTS = 5;
// 「確かめる」を続けて押せる間隔（Vercel の API と DNS に問い合わせるので）
export const LINK_DOMAIN_CHECK_INTERVAL_MS = 10_000;

// つながったかを確かめるときに、利用者のドメインで開くパス。proxy がこの文を返す（DNS と証明書がそろって矢書に届いている印）
export const LINK_CHECK_PATH = "/__yabumi/link-check";
export const LINK_CHECK_BODY = "yabumi-link-domain-ok";

export function linkDomainLimit(raw = process.env.LINK_DOMAIN_LIMIT): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LINK_DOMAIN_LIMIT;
}

// 2 段の公開の区切り（example.co.jp の co.jp など）。これの 1 つ下が、利用者が買ったドメインそのもの（apex）
const SECOND_LEVEL = new Set([
  "co.jp", "ne.jp", "or.jp", "ac.jp", "ad.jp", "ed.jp", "go.jp", "gr.jp", "lg.jp",
  "co.uk", "org.uk", "me.uk", "com.au", "net.au", "org.au", "co.nz", "co.kr", "com.tw", "com.cn", "com.hk", "com.sg", "com.br", "co.in",
]);

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
// 使えないドメイン: 矢書と Vercel のもの、内部やテスト用の名前
const RESERVED = /(^|\.)(yabumi\.app|vercel\.app|vercel\.com|vercel-dns\.com|now\.sh)$|\.(localhost|local|internal|test|invalid|example|onion)$|^localhost$/;

export type DomainCheck = { ok: true; domain: string } | { ok: false; error: string; suggestion?: string };

// ドメインそのもの（apex。例 example.com、example.co.jp）か
export function isApexDomain(domain: string): boolean {
  const labels = domain.split(".");
  if (labels.length <= 2) return true;
  return labels.length === 3 && SECOND_LEVEL.has(labels.slice(1).join("."));
}

// 入れられた文字をドメインの形に直して確かめる。https:// や末尾の / は付いていてもよい
export function normalizeLinkDomain(input: string): DomainCheck {
  let s = input.trim().toLowerCase();
  if (!s) return { ok: false, error: "ドメインを入れてください（例: go.example.com）。" };
  s = s.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "").replace(/\.+$/, "");
  if (/[@:\s]/.test(s)) return { ok: false, error: "ドメインだけを入れてください（例: go.example.com）。" };
  let host: string;
  try {
    // 日本語のドメインは xn-- の形に直る
    host = new URL(`https://${s}`).hostname.replace(/\.+$/, "");
  } catch {
    return { ok: false, error: "ドメインの形になっていません（例: go.example.com）。" };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return { ok: false, error: "IP アドレスは使えません。ドメインを入れてください（例: go.example.com）。" };
  const labels = host.split(".");
  if (host.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l)) || /^\d+$/.test(labels[labels.length - 1])) {
    return { ok: false, error: "ドメインの形になっていません。使えるのは英数字と - と . です（例: go.example.com）。" };
  }
  if (RESERVED.test(host)) return { ok: false, error: "このドメインは使えません。あなたが持っているドメインを入れてください。" };
  if (isApexDomain(host)) {
    return {
      ok: false,
      error: `${host} そのものではなく、先頭に go. などを付けた「サブドメイン」にしてください。${host} そのものを使うと、今のホームページやメールが届かなくなるおそれがあります。`,
      suggestion: `go.${host}`,
    };
  }
  return { ok: true, domain: host };
}

// サブドメインの、DNS に入れる「名前」の欄（go.example.com なら go。DNS のサービスの多くは、ドメインの部分を省いて入れる）
export function dnsRecordName(fqdn: string, apex: string): string {
  if (fqdn === apex) return "@";
  return fqdn.endsWith(`.${apex}`) ? fqdn.slice(0, -(apex.length + 1)) : fqdn;
}

// ドメインのうち、利用者が買った部分（apex）。example.co.jp も扱う
export function apexOf(domain: string): string {
  const labels = domain.split(".");
  const two = labels.slice(-2).join(".");
  return SECOND_LEVEL.has(two) ? labels.slice(-3).join(".") : two;
}
