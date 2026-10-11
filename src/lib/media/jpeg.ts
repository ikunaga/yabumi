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
