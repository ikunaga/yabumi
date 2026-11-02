// JPEG の中身を確かめ、位置情報などのメタデータを消す（docs/architecture.md の 4.18）。
// 画面はブラウザで JPEG に描き直してから上げるのでメタデータは残らないが、画面を通さずに Storage へ直接上げることもできるので、
// サーバーでも必ず通す。拡張子や Content-Type ではなく、ファイルの中身（JPEG の区切り）を読んで判断する。
//
// 残すもの: APP0（JFIF）、APP2 の ICC_PROFILE（色の情報）、APP14（Adobe。色の変換に要る）、画像そのもの（DQT・DHT・SOF・DRI・SOS 以降）
// 消すもの: APP1（Exif・XMP。撮影の場所・日時・機種など）、そのほかの APPn、COM（コメント）

export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImageError";
  }
}

export type SanitizedJpeg = { bytes: Uint8Array; width: number; height: number };

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP2 = 0xe2;
const APP14 = 0xee;
const COM = 0xfe;

// 長さを持たないマーカー（RST0〜7、TEM）
function isStandalone(marker: number) {
  return (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01;
}

// 大きさが入っている SOF（DHT の C4、JPG の C8、DAC の CC は除く）
function isSof(marker: number) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function startsWithAscii(bytes: Uint8Array, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

export function sanitizeJpeg(input: Uint8Array): SanitizedJpeg {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI) throw new InvalidImageError("JPEG の画像ではありません");

  const kept: Uint8Array[] = [input.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let i = 2;

  while (i < input.length) {
    if (input[i] !== 0xff) throw new InvalidImageError("JPEG の形が壊れています");
    // 区切りの前の詰め物（0xFF の連続）は飛ばす
    while (i < input.length && input[i] === 0xff) i++;
    if (i >= input.length) break;
    const marker = input[i];
    const start = i - 1;
    i++;

    if (marker === EOI) {
      kept.push(input.subarray(start, i));
      break;
    }
    if (isStandalone(marker)) {
      kept.push(input.subarray(start, i));
      continue;
    }
    if (i + 2 > input.length) throw new InvalidImageError("JPEG の形が壊れています");
    const length = (input[i] << 8) | input[i + 1];
    if (length < 2 || i + length > input.length) throw new InvalidImageError("JPEG の形が壊れています");
    const end = i + length;

    if (marker === SOS) {
      // ここから先は画像そのもの（と終わりの印）。そのまま写す
      if (!width || !height) throw new InvalidImageError("画像の大きさが読めません");
      kept.push(input.subarray(start));
      i = input.length;
      break;
    }

    if (isSof(marker)) {
      if (length < 7) throw new InvalidImageError("JPEG の形が壊れています");
      height = (input[i + 3] << 8) | input[i + 4];
      width = (input[i + 5] << 8) | input[i + 6];
    }

    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep =
      (!isApp && marker !== COM) ||
      marker === APP0 ||
      marker === APP14 ||
      (marker === APP2 && startsWithAscii(input, i + 2, "ICC_PROFILE\0"));
    if (keep) kept.push(input.subarray(start, end));
    i = end;
  }

  if (!width || !height) throw new InvalidImageError("画像の大きさが読めません");

  const total = kept.reduce((n, part) => n + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of kept) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { bytes, width, height };
}

// ── AI で作った画像の印（docs/architecture.md の 4.25、D25 の I5・D35） ──
// IPTC の「デジタルの出どころ（Digital Source Type）」を XMP（APP1）で入れる。Meta などはこの印を見て「AI 情報」のラベルを付ける。
// generated: AI が作った画像をそのまま、composite: AI の画像に文字などを重ねたもの。
// sanitizeJpeg で消したあとに、サーバーがこの印だけを入れる（利用者が送ったメタデータは残さない）
export type AiSource = "generated" | "composite";

const DIGITAL_SOURCE_TYPE: Record<AiSource, string> = {
  generated: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
  composite: "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia",
};

const XMP_NS = "http://ns.adobe.com/xap/1.0/\0";

export function aiXmpPacket(source: AiSource): string {
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `<Iptc4xmpExt:DigitalSourceType>${DIGITAL_SOURCE_TYPE[source]}</Iptc4xmpExt:DigitalSourceType>`,
    '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">AI-generated image (made with yabumi)</rdf:li></rdf:Alt></dc:description>',
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="r"?>',
  ].join("");
}

// sanitizeJpeg を通した JPEG に、AI の印（XMP）を入れる。APP0（JFIF）があればそのすぐ後、なければ SOI の後に置く
export function withAiMark(clean: Uint8Array, source: AiSource): Uint8Array {
  if (clean[0] !== 0xff || clean[1] !== SOI) throw new InvalidImageError("JPEG の画像ではありません");
  const payload = new TextEncoder().encode(XMP_NS + aiXmpPacket(source));
  const length = payload.length + 2;
  const segment = new Uint8Array(2 + length);
  segment.set([0xff, 0xe1, length >> 8, length & 0xff]);
  segment.set(payload, 4);
  let at = 2;
  if (clean[2] === 0xff && clean[3] === APP0) at = 4 + ((clean[4] << 8) | clean[5]);
  const out = new Uint8Array(clean.length + segment.length);
  out.set(clean.subarray(0, at));
  out.set(segment, at);
  out.set(clean.subarray(at), at + segment.length);
  return out;
}

// XMP に入っている AI の印を読む（テストと確かめ用）
export function readAiMark(bytes: Uint8Array): AiSource | null {
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  if (text.includes(DIGITAL_SOURCE_TYPE.composite)) return "composite";
  if (text.includes(DIGITAL_SOURCE_TYPE.generated)) return "generated";
  return null;
}
