import { isDestinationKind, isProductType, type DestinationKind, type ProductType } from "@/lib/projects/product-types";

// Instagram は本文の URL を押せない（リンクにならない）。URL を外し、最後に「▶︎ 〇〇はプロフィールのリンクから」の一言を入れる
// （docs/architecture.md の 4.37）。作成画面のボタンと、AI で投稿に整えるの Instagram の文面の両方で使う

// この言葉が入っていれば、もう一言が入っているとみなす（二重に足さない）
export const PROFILE_LINK_MARK = "プロフィールのリンク";

// 行き先の種類ごとの言い方（行き先の URL の種類がわかるとき）。「そのほか」は宣伝するものの種類で決める
const KIND_LEAD: Record<DestinationKind, string | null> = {
  site: "くわしく",
  booking: "ご予約",
  shop: "ご購入",
  store: "アプリ",
  form: "お申し込み・お問い合わせ",
  other: null,
};

// 宣伝するものの種類ごとの言い方（行き先の種類がわからないとき）
const TYPE_LEAD: Record<ProductType, string> = {
  app: "アプリ",
  web_service: "くわしく",
  shop: "ご予約・お店の場所",
  online_shop: "ご購入",
  service: "ご予約・お問い合わせ",
  creator: "作品",
  other: "くわしく",
};

// label: 作成画面の「行き先の URL を入れる」で選ぶときの名前（登録した名前、なければ種類の名前。ストアは App Store・Google Play）
export type ProfileLinkDestination = { kind: DestinationKind; url: string; label?: string };

// 作成画面に渡すもの: 宣伝するものの種類、行き先の URL（アプリならストアの URL も）、Instagram のプロフィールに置く短縮リンクを作ってあるか
export type ProfileLinkInfo = { productType: string | null; destinations: ProfileLinkDestination[]; hasInstagramLink: boolean };

// 入れる一言。url: 文面にあった URL（登録した行き先と同じなら、その種類の言い方にする）
export function profileLinkLine(opts: { productType?: string | null; destinations?: ProfileLinkDestination[]; url?: string | null }): string {
  const dests = opts.destinations ?? [];
  const matched = opts.url ? dests.find((d) => sameUrl(d.url, opts.url!)) : dests[0];
  const byKind = matched && isDestinationKind(matched.kind) ? KIND_LEAD[matched.kind] : null;
  const lead = byKind ?? (isProductType(opts.productType) ? TYPE_LEAD[opts.productType] : "くわしく");
  return `▶︎ ${lead}はプロフィールのリンクから`;
}

export const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

// http(s) の URL（短縮リンクの置き換えと同じ区切り。http も Instagram では押せないので外す）
const ANY_URL = /https?:\/\/[^\s<>"'「」『』（）()、。，．！？]+/g;

export function findUrls(text: string): string[] {
  return [...text.matchAll(ANY_URL)].map((m) => m[0].replace(/[.,!?:;]+$/, ""));
}

export function hasProfileLinkLine(text: string): boolean {
  return text.includes(PROFILE_LINK_MARK);
}

// URL を外したあとに残る「こちら：」「詳しくはこちら→」のような行（一言で置き換えるので消す）
const LEFTOVER_LINE = /^(?:[▶︎▶▷→⇒👉➡️・\s]*)(?:(?:詳しく|くわしく|ご予約|予約|ご購入|購入|お申し込み|申し込み|ダウンロード)は?)?(?:こちら|ここ|下記|以下|リンク)?(?:から)?(?:の?(?:ページ|サイト))?(?:[:：→⇒↓👇\s]*)$/u;
// URL の前に残るつなぎの記号
const TRAILING_JOINER = /[\s　]*[:：→⇒▶︎▶▷👉➡️]+[\s　]*$/u;

// 文面から URL を外し、最後（最後の行がハッシュタグだけなら、その前）に一言を入れる。もう一言があれば、URL を外すだけ
export function withProfileLink(text: string, line: string): string {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const rest = raw.replace(ANY_URL, "");
    if (rest === raw) {
      lines.push(raw);
      continue;
    }
    const kept = rest.replace(/[ 　]{2,}/g, " ").replace(TRAILING_JOINER, "").replace(/[\s　]+$/, "");
    if (kept.trim() === "" || LEFTOVER_LINE.test(kept.trim())) {
      // URL だけの行なら、すぐ前の「ご予約はこちら：」のような前置きの行も消す
      const prev = lines[lines.length - 1]?.trim();
      if (kept.trim() === "" && prev && LEFTOVER_LINE.test(prev)) lines.pop();
      continue;
    }
    lines.push(kept);
  }
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (hasProfileLinkLine(body)) return body;
  if (!body) return line;
  const all = body.split("\n");
  const last = all[all.length - 1];
  if (all.length > 1 && /^(?:#\S+[\s　]*)+$/u.test(last.trim())) {
    const before = all.slice(0, -1).join("\n").trim();
    return `${before}\n\n${line}\n\n${last.trim()}`;
  }
  return `${body}\n\n${line}`;
}

// 本文に行き先の URL を入れる（作成画面の「行き先の URL を入れる」。docs/architecture.md の 4.40）。
// 最後（最後の行がハッシュタグだけなら、その前）に URL だけの行を足す。もう同じ URL があれば変えない
export function withDestinationUrl(text: string, url: string): string {
  if (findUrls(text).some((u) => sameUrl(u, url))) return text;
  const body = text.trim();
  if (!body) return url;
  const all = body.split("\n");
  const last = all[all.length - 1];
  if (all.length > 1 && /^(?:#\S+[\s　]*)+$/u.test(last.trim())) {
    const before = all.slice(0, -1).join("\n").trim();
    return `${before}\n\n${url}\n\n${last.trim()}`;
  }
  return `${body}\n\n${url}`;
}
