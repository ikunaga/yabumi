import { isManualSns, type SnsKey } from "@/lib/sns";

// 短縮リンクの決まり（docs/architecture.md の 4.22、決定 D20）。画面とサーバーの両方から読む

// 8 文字の英数字（62 の 8 乗 ≒ 218 兆通り。総当たりで他人のリンクを探すのは現実的でない）
export const CODE_LENGTH = 8;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789".split("");
// 紛らわしい字（0・O・1・l・I）は使わない。照合は保存された形と完全一致
export const CODE_PATTERN = /^[A-Za-z0-9]{6,12}$/;

export function generateCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const out: string[] = [];
  // 偏りが出ないよう、ALPHABET の長さの倍数を超える値は捨てる
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < CODE_LENGTH) {
    for (const b of random(CODE_LENGTH * 2)) {
      if (b < limit && out.length < CODE_LENGTH) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join("");
}

// 短縮リンクの URL。SHORT_LINK_BASE_URL（例 https://go.yabumi.app）がなければ <APP_URL>/go
export function shortLinkBase(env: { shortLinkBaseUrl?: string; appUrl?: string } = { shortLinkBaseUrl: process.env.SHORT_LINK_BASE_URL, appUrl: process.env.APP_URL }): string {
  const base = env.shortLinkBaseUrl?.trim() || `${(env.appUrl ?? "https://localhost:3100").replace(/\/$/, "")}/go`;
  return base.replace(/\/$/, "");
}

export function shortLinkUrl(code: string, base = shortLinkBase()): string {
  return `${base}/${code}`;
}

// ===== 押した人の見分け =====

export type Device = "ios" | "android" | "desktop" | "other";
export type Excluded = "bot" | "prefetch" | null;

// SNS のリンクのプレビューを作るクローラーなど。押した人として数えない
const BOT_PATTERN =
  /bot|crawler|spider|preview|facebookexternalhit|meta-external|twitterbot|slackbot|discordbot|telegrambot|whatsapp|linkedinbot|embedly|quora link|pinterest|skypeuripreview|vkshare|curl|wget|python-requests|httpclient|headless|okhttp|go-http-client/i;

export function classifyRequest(input: { userAgent: string | null; purpose: string | null }): { device: Device; excluded: Excluded } {
  const ua = input.userAgent ?? "";
  const device: Device = /iphone|ipad|ipod/i.test(ua)
    ? "ios"
    : /android/i.test(ua)
      ? "android"
      : /windows|macintosh|linux|cros/i.test(ua)
        ? "desktop"
        : "other";
  if (!ua || BOT_PATTERN.test(ua)) return { device, excluded: "bot" };
  // ブラウザの先読み（Sec-Purpose: prefetch、古い Purpose: prefetch）は、まだ押していない
  if (input.purpose && /prefetch|prerender/i.test(input.purpose)) return { device, excluded: "prefetch" };
  return { device, excluded: null };
}

// ===== 行き先に付ける印（どの SNS・どのリンクから来たかをストア側でも見られるように） =====

export function withTrackingParams(destination: string, opts: { sns: SnsKey | null; code: string; appStoreProviderToken?: string | null }): string {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return destination;
  }
  const source = opts.sns ?? "link";
  const campaign = `${source}-${opts.code}`.slice(0, 30);
  if (url.hostname === "apps.apple.com" || url.hostname === "itunes.apple.com") {
    // App Store のキャンペーンリンク: ct（30 字まで）と、開発者ごとの pt
    if (!url.searchParams.has("ct")) url.searchParams.set("ct", campaign);
    if (opts.appStoreProviderToken && !url.searchParams.has("pt")) url.searchParams.set("pt", opts.appStoreProviderToken);
    return url.toString();
  }
  if (url.hostname === "play.google.com") {
    // Google Play: referrer の中の UTM（Play Console の集客で、UTM の source・campaign ごとに見られる）
    if (!url.searchParams.has("referrer")) {
      url.searchParams.set("referrer", new URLSearchParams({ utm_source: source, utm_medium: "social", utm_campaign: opts.code }).toString());
    }
    return url.toString();
  }
  // ほかのサイト: UTM（すでにあれば上書きしない）
  if (!url.searchParams.has("utm_source")) {
    url.searchParams.set("utm_source", source);
    url.searchParams.set("utm_medium", "social");
    url.searchParams.set("utm_campaign", opts.code);
  }
  return url.toString();
}

// ===== 投稿の本文の URL を短縮リンクに置き換える =====

// 置き換える URL（https:// で始まるものだけ。末尾の句読点やかっこは URL に含めない）
const URL_PATTERN = /https:\/\/[^\s<>"'「」『』（）()、。，．！？]+/g;

export function findLinkableUrls(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(URL_PATTERN)) {
    const url = m[0].replace(/[.,!?:;]+$/, "");
    if (url.length <= 2000) found.add(url);
  }
  return [...found];
}

// 本文の URL を、対応する短縮リンクに置き換える（対応がない URL はそのまま）
export function substituteLinks(text: string, links: Map<string, string>): string {
  if (!links.size) return text;
  return text.replace(URL_PATTERN, (m) => {
    const url = m.replace(/[.,!?:;]+$/, "");
    const short = links.get(url);
    return short ? short + m.slice(url.length) : m;
  });
}

// 本文の URL を押せない SNS は置き換えない（プロフィールのリンクで数える）。手で投稿する SNS は、利用者が貼る文に入る
export function substitutesBodyLinks(sns: SnsKey): boolean {
  return sns !== "instagram";
}

export type ShortLinkPlan = {
  // 置き換える URL と、置き換える SNS（本文に出てくる順）
  replaced: { url: string; sns: SnsKey[] }[];
  // 本文に URL があっても置き換えない SNS と、その理由
  skipped: { sns: SnsKey; reason: "instagram" | "manual" }[];
};

// 作成画面に出す、どの URL をどの SNS で短縮リンクに置き換えるか（preparePostLinks と同じ決まり。送る前の配信先だけを渡す）
export function planShortLinks(targets: { sns: SnsKey; text: string }[]): ShortLinkPlan {
  const replaced = new Map<string, SnsKey[]>();
  const skipped: ShortLinkPlan["skipped"] = [];
  for (const t of targets) {
    const urls = findLinkableUrls(t.text);
    if (!urls.length) continue;
    if (isManualSns(t.sns)) skipped.push({ sns: t.sns, reason: "manual" });
    else if (!substitutesBodyLinks(t.sns)) skipped.push({ sns: t.sns, reason: "instagram" });
    else for (const u of urls) replaced.set(u, [...(replaced.get(u) ?? []), t.sns]);
  }
  return { replaced: [...replaced].map(([url, sns]) => ({ url, sns })), skipped };
}
