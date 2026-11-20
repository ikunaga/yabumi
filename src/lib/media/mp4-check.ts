// サーバーで、上がった MP4 の箱（ISO BMFF）を読んで確かめる（docs/design/video.md の 3.）。作り直さず、読むだけ。
// yabumi のブラウザで作った 1 本の形（video.md の 2.）に合わないものは受け付けない。
// メタデータの箱（udta・meta）があれば受け付けない（yabumi のブラウザで作ったものには入らない。撮影の場所などが残っているおそれがある）

import { MAX_VIDEO_BYTES, MAX_VIDEO_MS, MIN_VIDEO_MS, VIDEO_MIN_HEIGHT, VIDEO_MIN_WIDTH, VIDEO_OUT_HEIGHT, VIDEO_OUT_WIDTH } from "./video-rules";

export type Mp4Info = {
  durationMs: number;
  // 回転を当てたあとの見た目の縦横
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
};

export type Mp4Problem =
  | "not_mp4"
  | "too_large"
  | "moov_after_mdat"
  | "edit_list"
  | "metadata"
  | "video_tracks"
  | "video_codec"
  | "audio_tracks"
  | "audio_codec"
  | "too_short"
  | "too_long"
  | "too_small"
  | "too_big_dimensions"
  | "fps";

export class Mp4CheckError extends Error {
  constructor(readonly problem: Mp4Problem) {
    super(problem);
    this.name = "Mp4CheckError";
  }
}

type Box = { type: string; start: number; body: number; end: number };

// 箱を並べて読む（size 0 は最後まで、size 1 は 64 ビットの大きさ）
function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = dv.getUint32(at);
    const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > to) throw new Mp4CheckError("not_mp4");
      const big = dv.getBigUint64(at + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Mp4CheckError("not_mp4");
      size = Number(big);
      body = at + 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < body - at || at + size > to) throw new Mp4CheckError("not_mp4");
    out.push({ type, start: at, body, end: at + size });
    at += size;
  }
  if (at !== to) throw new Mp4CheckError("not_mp4");
  return out;
}

const child = (b: Uint8Array, box: Box, type: string, skip = 0): Box | undefined => boxes(b, box.body + skip, box.end).find((x) => x.type === type);
const children = (b: Uint8Array, box: Box, skip = 0): Box[] => boxes(b, box.body + skip, box.end);

function need<T>(v: T | undefined): T {
  if (v === undefined) throw new Mp4CheckError("not_mp4");
  return v;
}

// 箱の中のどこかに type の箱があるか（moov の下を全部見る。中身が箱でない箱は飛ばす）
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "dinf", "edts", "mvex"]);
function hasDeep(b: Uint8Array, box: Box, types: Set<string>): boolean {
  for (const c of children(b, box)) {
    if (types.has(c.type)) return true;
    if (CONTAINERS.has(c.type) && hasDeep(b, c, types)) return true;
  }
  return false;
}

// mdhd / mvhd の timescale と duration（version 0 は 32 ビット、1 は 64 ビット）
function timeOf(b: Uint8Array, box: Box): { timescale: number; duration: number } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const version = b[box.body];
  if (version === 1) {
    return { timescale: dv.getUint32(box.body + 4 + 16), duration: Number(dv.getBigUint64(box.body + 4 + 20)) };
  }
  return { timescale: dv.getUint32(box.body + 4 + 8), duration: dv.getUint32(box.body + 4 + 12) };
}

// tkhd の縦横（16.16 の固定小数点）と、行列から 90 度・270 度の回転か
function tkhdSize(b: Uint8Array, box: Box): { width: number; height: number; rotated: boolean } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const version = b[box.body];
  const base = box.body + 4 + (version === 1 ? 32 : 20);
  // base: reserved(8) layer(2) alternate_group(2) volume(2) reserved(2) matrix(36) width(4) height(4)
  const matrix = base + 16;
  const a = dv.getInt32(matrix);
  const bb = dv.getInt32(matrix + 4);
  const width = dv.getUint32(matrix + 36) / 65536;
  const height = dv.getUint32(matrix + 40) / 65536;
  return { width: Math.round(width), height: Math.round(height), rotated: a === 0 && bb !== 0 };
}

function handlerOf(b: Uint8Array, mdia: Box): string {
  const hdlr = need(child(b, mdia, "hdlr"));
  return String.fromCharCode(...b.subarray(hdlr.body + 8, hdlr.body + 12));
}

function sampleEntry(b: Uint8Array, stbl: Box): Box {
  const stsd = need(child(b, stbl, "stsd"));
  // stsd: version/flags(4) entry_count(4) のあとに箱
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(stsd.body + 4) !== 1) throw new Mp4CheckError("not_mp4");
  return need(children(b, stsd, 8)[0]);
}

// mp4a の esds が AAC-LC（objectTypeIndication 0x40、Audio Object Type 2）か
function isAacLc(b: Uint8Array, mp4a: Box): boolean {
  // AudioSampleEntry: reserved(6) data_reference_index(2) reserved(8) channelcount(2) samplesize(2) pre_defined(2) reserved(2) samplerate(4) = 28
  const esds = boxes(b, mp4a.body + 28, mp4a.end).find((x) => x.type === "esds");
  if (!esds) return false;
  const d = b.subarray(esds.body + 4, esds.end);
  // 記述子をたどる: 0x03 ES_Descriptor → 0x04 DecoderConfigDescriptor → 0x05 DecoderSpecificInfo
  let i = 0;
  const readLen = () => {
    let len = 0;
    for (let k = 0; k < 4 && i < d.length; k++) {
      const c = d[i++];
      len = (len << 7) | (c & 0x7f);
      if (!(c & 0x80)) break;
    }
    return len;
  };
  if (d[i++] !== 0x03) return false;
  readLen();
  i += 2; // ES_ID
  const flags = d[i++];
  if (flags & 0x80) i += 2;
  if (flags & 0x40) i += 1 + d[i];
  if (flags & 0x20) i += 2;
  if (d[i++] !== 0x04) return false;
  readLen();
  const oti = d[i];
  i += 13;
  if (oti !== 0x40) return false;
  if (d[i++] !== 0x05) return false;
  readLen();
  const aot = d[i] >> 3;
  return aot === 2;
}

// stts から平均の fps
function fpsOf(b: Uint8Array, stbl: Box, timescale: number): number {
  const stts = need(child(b, stbl, "stts"));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(stts.body + 4);
  let samples = 0;
  let total = 0;
  for (let k = 0; k < n; k++) {
    const at = stts.body + 8 + k * 8;
    if (at + 8 > stts.end) throw new Mp4CheckError("not_mp4");
    const count = dv.getUint32(at);
    samples += count;
    total += count * dv.getUint32(at + 4);
  }
  return total > 0 ? (samples * timescale) / total : 0;
}

export function checkMp4(b: Uint8Array): Mp4Info {
  if (b.length > MAX_VIDEO_BYTES) throw new Mp4CheckError("too_large");
  const top = boxes(b, 0, b.length);
  if (top[0]?.type !== "ftyp") throw new Mp4CheckError("not_mp4");
  const moovAt = top.findIndex((x) => x.type === "moov");
  const mdatAt = top.findIndex((x) => x.type === "mdat");
  if (moovAt < 0 || mdatAt < 0) throw new Mp4CheckError("not_mp4");
  if (moovAt > mdatAt) throw new Mp4CheckError("moov_after_mdat");
  if (top.some((x) => x.type === "udta" || x.type === "meta" || x.type === "moof")) throw new Mp4CheckError("metadata");
  const moov = top[moovAt];
  if (hasDeep(b, moov, new Set(["udta", "meta"]))) throw new Mp4CheckError("metadata");
  if (hasDeep(b, moov, new Set(["edts", "elst"]))) throw new Mp4CheckError("edit_list");

  const traks = children(b, moov).filter((x) => x.type === "trak");
  const video: { trak: Box; mdia: Box; stbl: Box }[] = [];
  const audio: { trak: Box; mdia: Box; stbl: Box }[] = [];
  for (const trak of traks) {
    const mdia = need(child(b, trak, "mdia"));
    const stbl = need(child(b, need(child(b, mdia, "minf")), "stbl"));
    const h = handlerOf(b, mdia);
    if (h === "vide") video.push({ trak, mdia, stbl });
    else if (h === "soun") audio.push({ trak, mdia, stbl });
  }
  if (video.length !== 1) throw new Mp4CheckError("video_tracks");
  if (audio.length > 1) throw new Mp4CheckError("audio_tracks");
  const v = video[0];
  if (sampleEntry(b, v.stbl).type !== "avc1") throw new Mp4CheckError("video_codec");
  if (audio.length) {
    const entry = sampleEntry(b, audio[0].stbl);
    if (entry.type !== "mp4a" || !isAacLc(b, entry)) throw new Mp4CheckError("audio_codec");
  }

  const vt = timeOf(b, need(child(b, v.mdia, "mdhd")));
  if (!vt.timescale) throw new Mp4CheckError("not_mp4");
  const durationMs = Math.round((vt.duration * 1000) / vt.timescale);
  if (durationMs < MIN_VIDEO_MS) throw new Mp4CheckError("too_short");
  // 切り取りの端数（フレームの区切り）で少しだけ超えることがあるので、0.5 秒まで許す
  if (durationMs > MAX_VIDEO_MS + 500) throw new Mp4CheckError("too_long");

  const size = tkhdSize(b, need(child(b, v.trak, "tkhd")));
  const width = size.rotated ? size.height : size.width;
  const height = size.rotated ? size.width : size.height;
  if (width < VIDEO_MIN_WIDTH || height < VIDEO_MIN_HEIGHT) throw new Mp4CheckError("too_small");
  if (width > VIDEO_OUT_WIDTH || height > VIDEO_OUT_HEIGHT) throw new Mp4CheckError("too_big_dimensions");

  const fps = fpsOf(b, v.stbl, vt.timescale);
  if (fps < 23 || fps > 60.5) throw new Mp4CheckError("fps");

  return { durationMs, width, height, fps: Math.round(fps * 100) / 100, hasAudio: audio.length === 1 };
}

// 利用者に見せる文
export function mp4ProblemMessage(p: Mp4Problem): string {
  switch (p) {
    case "too_large":
      return "動画が大きすぎます。もう一度選び直してください。";
    case "too_short":
      return "3 秒以上の動画を選んでください。";
    case "too_long":
      return "動画が 90 秒を超えています。使う範囲を選び直してください。";
    case "too_small":
      return "動画が小さすぎます（縦 960・横 540 以上の動画を選んでください）。";
    case "audio_codec":
      return "この動画の音声は扱えません。別の動画を選んでください。";
    default:
      return "動画を確認できませんでした。yabumi の画面からもう一度選び直してください。";
  }
}
