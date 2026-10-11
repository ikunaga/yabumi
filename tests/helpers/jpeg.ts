// テスト用の JPEG を組み立てる（中身は画像として表示できなくてよい。区切りの形だけ本物に合わせる）
function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

export const EXIF_GPS_MARK = "GPSLatitude=35.6812";
export const COMMENT_MARK = "secret-comment";

export function testJpeg({ width = 640, height = 480, exif = true, comment = true }: { width?: number; height?: number; exif?: boolean; comment?: boolean } = {}): Uint8Array {
  const bytes = [
    0xff, 0xd8,
    ...segment(0xe0, [...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(exif ? segment(0xe1, [...ascii("Exif\0\0"), ...ascii(EXIF_GPS_MARK)]) : []),
    ...(comment ? segment(0xfe, ascii(COMMENT_MARK)) : []),
    ...segment(0xdb, [0, ...new Array(64).fill(1)]),
    ...segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    ...segment(0xc4, [0, ...new Array(16).fill(0)]),
    ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    // 画像の本体（中に 0xFF 0x00 の詰め物や再開の印があってもそのまま写す）
    0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78,
    0xff, 0xd9,
  ];
  return new Uint8Array(bytes);
}

export function includesAscii(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text, "latin1"));
}
