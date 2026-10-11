// X の文字数の数え方と、URL の見つけ方（https://docs.x.com/fundamentals/counting-characters）。
// 上限は重み付きで 280。半角英数などは 1、日本語（CJK）などは 2、絵文字は組み合わせても 1 つで 2、URL は長さに関係なく 23。
// URL があるかどうかは X の API 料金（1 本 $0.015 か $0.20 か）も決めるので、迷うものは URL として数える側に倒す。
// 公式の twitter-text は依存が重い（core-js など）ので使わず、同じ決まりをここに書いている

export const X_MAX_WEIGHT = 280;
export const X_URL_WEIGHT = 23;

// 重み 1 の文字の範囲（twitter-text の v3 の設定と同じ）
const LIGHT_RANGES: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

// http(s):// のない「example.com」も URL になる。X は一般のドメイン（.com など）なら URL にし、
// 国のドメイン（2 文字）は後ろにパスがあるときだけ URL にする（twitter-text の決まり）。
// ただし個人開発でよく使う 2 文字のドメインは、パスがなくても URL として数える（料金を少なく見積もらないため）
const GENERIC_TLDS = new Set(
  "com net org info biz edu gov mil int app dev page blog tech site online xyz shop store cloud design news link live life world today space website studio games game run tools software codes digital media email zone club pro".split(" "),
);
const ALWAYS_URL_CC_TLDS = new Set("co tv ai io me gg sh so to ly fm jp".split(" "));

// URL は半角の文字だけでできている。「https://example.comです」のように日本語が続いたら、そこで終わる
const SCHEME_URL = /https?:\/\/[!-~]+/giy;
// 前に英数字・@・.・- がないところから始まるドメイン（メールアドレスやファイル名の途中は拾わない）
const BARE_URL = /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24})(?![a-z0-9-])(\/[!-~]*)?/giy;

// 末尾の句読点やかっこは URL に含めない
function trimTrailing(url: string): string {
  return url.replace(/[.,!?:;'")\]}>、。！？」』）]+$/u, "");
}

export type FoundUrl = { start: number; end: number; url: string };

// 本文の中の URL（X が URL として扱うもの）を前から順に返す
export function findXUrls(text: string): FoundUrl[] {
  const found: FoundUrl[] = [];
  let i = 0;
  while (i < text.length) {
    const prev = i > 0 ? text[i - 1] : "";
    const boundary = !/[a-z0-9@.\-_/]/i.test(prev);
    if (boundary) {
      SCHEME_URL.lastIndex = i;
      const m = SCHEME_URL.exec(text);
      if (m) {
        const url = trimTrailing(m[0]);
        // 「https://」だけで中身のないものは URL にしない
        if (/^https?:\/\/\S/i.test(url)) {
          found.push({ start: i, end: i + url.length, url });
          i += url.length;
          continue;
        }
      }
      BARE_URL.lastIndex = i;
      const b = BARE_URL.exec(text);
      if (b) {
        const tld = b[1].toLowerCase();
        const path = b[2];
        const isUrl = GENERIC_TLDS.has(tld) || (tld.length === 2 && (Boolean(path) || ALWAYS_URL_CC_TLDS.has(tld)));
        // 直後が @ ならメールアドレスの一部（user@example.com の user. のような形）なので除く
        if (isUrl && text[i + b[0].length] !== "@") {
          const url = trimTrailing(b[0]);
          found.push({ start: i, end: i + url.length, url });
          i += url.length;
          continue;
        }
      }
    }
    i += 1;
  }
  return found;
}

export function hasXUrl(text: string): boolean {
  return findXUrls(text).length > 0;
}

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("ja", { granularity: "grapheme" }) : null;

function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

function weightOfPlain(text: string): number {
  let weight = 0;
  for (const g of graphemes(text)) {
    // 絵文字は、肌の色や ZWJ で組み合わせたもの（👨‍👩‍👧 など）も 1 つで 2
    if (EMOJI.test(g)) {
      weight += 2;
      continue;
    }
    for (const ch of g) {
      const cp = ch.codePointAt(0)!;
      weight += LIGHT_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
    }
  }
  return weight;
}

// X の重み付きの文字数（上限 280）。X と同じく NFC に正規化してから数える
export function xWeightedLength(text: string): number {
  const normalized = text.normalize("NFC");
  let weight = 0;
  let last = 0;
  for (const u of findXUrls(normalized)) {
    weight += weightOfPlain(normalized.slice(last, u.start)) + X_URL_WEIGHT;
    last = u.end;
  }
  return weight + weightOfPlain(normalized.slice(last));
}
