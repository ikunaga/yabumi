// テスト用の小さな MP4（箱の形だけ。映像・音声の中身は入れない）。checkMp4（src/lib/media/mp4-check.ts）の確かめと、
// 動画の上げ方の結合テストに使う。中身のバイナリのファイルを置かずに、形の違う見本を作れるようにする

export type TestMp4Options = {
  durationMs?: number;
  width?: number;
  height?: number;
  // 90 度回した行列（width・height は回す前の値）
  rotate90?: boolean;
  fps?: number;
  videoCodec?: "avc1" | "hvc1";
  // none: 音声なし、aac: AAC-LC、heaac: HE-AAC（AOT 5）、opus: Opus
  audio?: "none" | "aac" | "heaac" | "opus";
  moovAfterMdat?: boolean;
  editList?: boolean;
  udta?: boolean;
  // mdat の大きさ（バイト。大きさの確かめ用）
  mdatBytes?: number;
};

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}
function box(type: string, ...parts: (number[] | Uint8Array)[]): number[] {
  const body = parts.flatMap((p) => Array.from(p));
  return [...u32(8 + body.length), ...type.split("").map((c) => c.charCodeAt(0)), ...body];
}
function full(type: string, version: number, ...parts: number[][]): number[] {
  return box(type, [version, 0, 0, 0], ...parts);
}
const zeros = (n: number) => new Array<number>(n).fill(0);

function matrix(rotate: boolean): number[] {
  // 16.16 の固定小数点（a, b, u, c, d, v, x, y, w）
  const one = 0x00010000;
  const minus = 0xffff0000;
  return rotate
    ? [...u32(0), ...u32(one), ...u32(0), ...u32(minus), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)]
    : [...u32(one), ...u32(0), ...u32(0), ...u32(0), ...u32(one), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
}

function trak(o: { handler: "vide" | "soun"; timescale: number; duration: number; width: number; height: number; rotate: boolean; entry: number[]; stts: [number, number][]; editList: boolean }) {
  const tkhd = full("tkhd", 0, zeros(8), u32(1), zeros(4), u32(o.duration), zeros(8), zeros(4), zeros(4), matrix(o.rotate), u32(o.width * 65536), u32(o.height * 65536));
  const mdhd = full("mdhd", 0, zeros(8), u32(o.timescale), u32(o.duration), zeros(4));
  const hdlr = full("hdlr", 0, zeros(4), o.handler.split("").map((c) => c.charCodeAt(0)), zeros(12), [0]);
  const stsd = full("stsd", 0, u32(1), o.entry);
  const stts = full("stts", 0, u32(o.stts.length), o.stts.flatMap(([c, d]) => [...u32(c), ...u32(d)]));
  const stbl = box("stbl", stsd, stts);
  const minf = box("minf", stbl);
  const mdia = box("mdia", mdhd, hdlr, minf);
  const edts = o.editList ? [box("edts", full("elst", 0, u32(1), u32(o.duration), u32(0), u32(0x00010000)))] : [];
  return box("trak", tkhd, ...edts, mdia);
}

function avc(type: string, w: number, h: number) {
  // VisualSampleEntry: reserved(6) dref(2) pre/reserved(16) width(2) height(2) res(8) reserved(4) frame_count(2) compressor(32) depth(2) pre(2) = 78
  return box(type, zeros(6), u16(1), zeros(16), u16(w), u16(h), zeros(8), zeros(4), u16(1), zeros(32), u16(0x18), u16(0xffff), box("avcC", [1, 0x64, 0, 0x28, 0xff, 0xe0, 0]));
}

function mp4a(aot: number) {
  // DecoderSpecificInfo の 1 バイト目: AOT(5 ビット)
  const dsi = [0x05, 2, (aot << 3) | 0x01, 0x90];
  const dcd = [0x04, 13 + dsi.length, 0x40, 0x15, 0, 0, 0, ...u32(128000), ...u32(128000), ...dsi];
  const es = [0x03, 3 + dcd.length + 3, 0, 1, 0, ...dcd, 0x06, 1, 2];
  return box("mp4a", zeros(6), u16(1), zeros(8), u16(2), u16(16), zeros(4), u32(48000 * 65536), full("esds", 0, es));
}

export function testMp4(opts: TestMp4Options = {}): Uint8Array {
  const durationMs = opts.durationMs ?? 10_000;
  const width = opts.width ?? 1080;
  const height = opts.height ?? 1920;
  const fps = opts.fps ?? 30;
  const timescale = 30_000;
  const duration = Math.round((durationMs * timescale) / 1000);
  const frames = Math.max(1, Math.round((durationMs / 1000) * fps));
  const delta = Math.round(duration / frames);

  const video = trak({
    handler: "vide",
    timescale,
    duration: frames * delta,
    width,
    height,
    rotate: Boolean(opts.rotate90),
    entry: avc(opts.videoCodec ?? "avc1", width, height),
    stts: [[frames, delta]],
    editList: Boolean(opts.editList),
  });
  const audioKind = opts.audio ?? "aac";
  const audio =
    audioKind === "none"
      ? []
      : [
          trak({
            handler: "soun",
            timescale: 48_000,
            duration: Math.round((durationMs * 48_000) / 1000),
            width: 0,
            height: 0,
            rotate: false,
            entry: audioKind === "opus" ? box("Opus", zeros(6), u16(1), zeros(8), u16(2), u16(16), zeros(4), u32(48000 * 65536)) : mp4a(audioKind === "heaac" ? 5 : 2),
            stts: [[Math.ceil((durationMs / 1000) * 46.875), 1024]],
            editList: false,
          }),
        ];
  const mvhd = full("mvhd", 0, zeros(8), u32(1000), u32(durationMs), u32(0x00010000), u16(0x0100), zeros(10), matrix(false), zeros(24), u32(3));
  const udta = opts.udta ? [box("udta", box("©xyz", [0, 0x0d, 0x15, 0xc7], "+35.6+139.7/".split("").map((c) => c.charCodeAt(0))))] : [];
  const moov = box("moov", mvhd, video, ...audio, ...udta);
  const ftyp = box("ftyp", "isom".split("").map((c) => c.charCodeAt(0)), u32(0x200), "isomiso2avc1mp41".split("").map((c) => c.charCodeAt(0)));
  const mdat = box("mdat", zeros(opts.mdatBytes ?? 64));
  const parts = opts.moovAfterMdat ? [ftyp, mdat, moov] : [ftyp, moov, mdat];
  return Uint8Array.from(parts.flat());
}
