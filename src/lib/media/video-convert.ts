// ブラウザで動画を読み取り、yabumi の 1 本の形に作り直す（docs/design/video.md の 2.）。画面（client）からだけ使う。
// mediabunny（WebCodecs）は大きいので、動画を選んだときに読み込む（import() で分ける）。
// 映像はいつも作り直す（30fps 固定・2 秒ごとのキーフレーム・9:16 の枠に収める・回転を映像に焼き込む）。音声は作り直さずにコピーする（AAC-LC だけ。W5）。
// メタデータ（撮影の場所・日時・機種）は書き出さない（tags を空にする。指定しないと mediabunny は元のタグを書き写す）

import { MAX_VIDEO_BYTES, VIDEO_FPS, VIDEO_KEYFRAME_SECONDS, videoBitrate } from "./video-rules";
import { outputSize, probeProblem, probeProblemMessage, type VideoProbe, type VideoRange } from "./video-plan";

export class VideoPrepError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "VideoPrepError";
  }
}

const UNSUPPORTED_BROWSER =
  "このブラウザでは動画を整えられません。スマホの Chrome か Safari、パソコンの Chrome・Edge・Safari で開いてください。";
const UNREADABLE_FORMAT = "この動画の形式は、この端末では読めません。スマホから選ぶか、別の動画を選んでください。";

// 音声の作り直しはしないので、コピーした音声のビットレートの見込み（ビットレートの計算で、映像に回す分を決めるため）
const AUDIO_BITRATE_GUESS = 192_000;

async function openInput(file: File) {
  const mb = await import("mediabunny");
  return { mb, input: new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) }) };
}

export type Prepared = { probe: VideoProbe; size: { width: number; height: number } };

// 読み取る（作り直さず、箱を読むだけ）。受け付けない動画・このブラウザで整えられない動画は VideoPrepError
export async function probeVideo(file: File): Promise<Prepared> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") throw new VideoPrepError(UNSUPPORTED_BROWSER);
  const { mb, input } = await openInput(file);
  try {
    let video;
    try {
      video = await input.getPrimaryVideoTrack();
    } catch {
      throw new VideoPrepError("この動画は読み取れませんでした。別の動画を選んでください。");
    }
    if (!video) throw new VideoPrepError("この動画は読み取れませんでした。別の動画を選んでください。");
    const durationMs = Math.round((await input.computeDuration()) * 1000);
    const audioTrack = await input.getPrimaryAudioTrack();
    let audio: VideoProbe["audio"] = "none";
    if (audioTrack) {
      const param = await audioTrack.getCodecParameterString();
      const lc = audioTrack.codec === "aac" && (param === "mp4a.40.2" || param === "mp4a.40" || param === null);
      audio = lc && audioTrack.numberOfChannels <= 2 && audioTrack.sampleRate <= 48_000 ? "aac" : "other";
    }
    const probe: VideoProbe = { durationMs, width: video.displayWidth, height: video.displayHeight, audio };
    const problem = probeProblem(probe);
    if (problem) throw new VideoPrepError(probeProblemMessage(problem));
    const size = outputSize(probe.width, probe.height)!;
    if (!(await video.canDecode())) throw new VideoPrepError(UNREADABLE_FORMAT);
    const bitrate = videoBitrate(Math.min(durationMs, 90_000), AUDIO_BITRATE_GUESS);
    if (!(await mb.canEncodeVideo("avc", { width: size.width, height: size.height, bitrate }))) throw new VideoPrepError(UNSUPPORTED_BROWSER);
    return { probe, size };
  } finally {
    input.dispose();
  }
}

export type ConvertOptions = { onProgress?: (ratio: number) => void; signal?: AbortSignal };

// 作り直す。range は使う範囲（3〜90 秒。画面で clampRange 済み）
export async function convertVideo(file: File, prepared: Prepared, range: VideoRange, opts: ConvertOptions = {}): Promise<Blob> {
  const { mb, input } = await openInput(file);
  try {
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const durationMs = range.endMs - range.startMs;
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: {
        codec: "avc",
        width: prepared.size.width,
        height: prepared.size.height,
        fit: "contain",
        frameRate: VIDEO_FPS,
        keyFrameInterval: VIDEO_KEYFRAME_SECONDS,
        bitrate: videoBitrate(durationMs, AUDIO_BITRATE_GUESS),
        allowTransformationMetadata: false,
        forceTranscode: true,
      },
      audio: prepared.probe.audio === "none" ? { discard: true } : { codec: "aac", forceTranscode: false },
      trim: { start: range.startMs / 1000, end: range.endMs / 1000 },
      // コピーした音声の始まりの時刻（AAC の頭の空白・切り取りの端）を 0 に寄せる。寄せないと edit list（edts）が書かれ、
      // Threads・Instagram の決まり（edit list なし）に合わない。音と映像のずれは保たれる（mediabunny の資料）。2026-11-15 に Chrome で確かめた
      copy: { shiftTolerance: Infinity, boundaryPolicy: "shrink" },
      tags: {},
      showWarnings: false,
    });
    if (!conversion.isValid) {
      console.error("[video] 作り直せません", conversion.discardedTracks.map((t) => t.reason));
      throw new VideoPrepError(UNSUPPORTED_BROWSER);
    }
    if (opts.onProgress) conversion.onProgress = (p) => opts.onProgress!(p);
    const abort = () => void conversion.cancel();
    opts.signal?.addEventListener("abort", abort, { once: true });
    try {
      await conversion.execute();
    } catch (e) {
      if (opts.signal?.aborted) throw new DOMException("やめました", "AbortError");
      console.error("[video] 作り直しに失敗しました", e instanceof Error ? e.message : e);
      throw new VideoPrepError("動画を整えられませんでした。もう一度お試しいただくか、別の動画を選んでください。");
    } finally {
      opts.signal?.removeEventListener("abort", abort);
    }
    const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buffer) throw new VideoPrepError("動画を整えられませんでした。もう一度お試しください。");
    if (buffer.byteLength > MAX_VIDEO_BYTES) throw new VideoPrepError("整えた動画が大きすぎます。使う範囲を短くしてください。");
    return new Blob([buffer], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}
