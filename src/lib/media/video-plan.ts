// ブラウザで動画を整える前の判定（docs/design/video.md の 2.）。ブラウザの API に触れない、テストできる部分だけ
import { MAX_VIDEO_MS, MIN_VIDEO_MS, VIDEO_MIN_HEIGHT, VIDEO_MIN_WIDTH, VIDEO_OUT_HEIGHT, VIDEO_OUT_WIDTH } from "./video-rules";

// 読み取った動画（回転を当てたあとの見た目の縦横）。audio: none は音声なし、aac は AAC-LC、other はそれ以外（作り直せないので受け付けない。W5）
export type VideoProbe = { durationMs: number; width: number; height: number; audio: "none" | "aac" | "other" };

export type ProbeProblem = "too_short" | "too_small" | "audio";

export function probeProblem(p: VideoProbe): ProbeProblem | null {
  if (p.durationMs < MIN_VIDEO_MS) return "too_short";
  if (outputSize(p.width, p.height) === null) return "too_small";
  if (p.audio === "other") return "audio";
  return null;
}

export function probeProblemMessage(p: ProbeProblem): string {
  if (p === "too_short") return "3 秒以上の動画を選んでください。";
  if (p === "too_small") return "動画が小さすぎます。もう少し大きな（画質のよい）動画を選んでください。";
  return "この動画の音声は扱えません。スマホのカメラで撮った動画など、別の動画を選んでください。";
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// 作り直したあとの縦横（縦 9:16 の枠。元が 1080×1920 の枠より大きければ枠いっぱいに縮め、小さければ拡大しない）。
// 枠が 540×960 に足りないときは null（Facebook リールの下限に届かない）
export function outputSize(width: number, height: number): { width: number; height: number } | null {
  if (width <= 0 || height <= 0) return null;
  // 元の動画が、1080×1920 の枠にどれだけの大きさで収まるか（枠の大きさに対する比）
  const scale = Math.min(1, Math.max(width / VIDEO_OUT_WIDTH, height / VIDEO_OUT_HEIGHT));
  const w = even(VIDEO_OUT_WIDTH * scale);
  const h = even(VIDEO_OUT_HEIGHT * scale);
  if (w < VIDEO_MIN_WIDTH || h < VIDEO_MIN_HEIGHT) return null;
  return { width: w, height: h };
}

export type VideoRange = { startMs: number; endMs: number };

// 使う範囲の初期値（90 秒以下なら全体、超えるなら最初の 90 秒）
export function defaultRange(durationMs: number): VideoRange {
  return { startMs: 0, endMs: Math.min(durationMs, MAX_VIDEO_MS) };
}

// 画面で動かした範囲を、長さの決まり（3〜90 秒・動画の中）に収める。動かしたのが始まりなら終わりを、終わりなら始まりを合わせる
export function clampRange(r: VideoRange, durationMs: number, moved: "start" | "end"): VideoRange {
  let start = Math.max(0, Math.min(r.startMs, durationMs - MIN_VIDEO_MS));
  let end = Math.max(MIN_VIDEO_MS, Math.min(r.endMs, durationMs));
  if (moved === "start") {
    if (end - start > MAX_VIDEO_MS) end = start + MAX_VIDEO_MS;
    if (end - start < MIN_VIDEO_MS) end = Math.min(durationMs, start + MIN_VIDEO_MS);
  } else {
    if (end - start > MAX_VIDEO_MS) start = end - MAX_VIDEO_MS;
    if (end - start < MIN_VIDEO_MS) start = Math.max(0, end - MIN_VIDEO_MS);
  }
  return { startMs: Math.round(start), endMs: Math.round(end) };
}

// 進み具合の目安の文（整える・上げる）
// confirm: 上げ終えて、サーバーが確かめている（やめるは出さない）
export function progressLabel(stage: "convert" | "upload" | "confirm", ratio: number): string {
  if (stage === "confirm") return "動画を確かめています";
  const pct = Math.max(0, Math.min(100, Math.floor(ratio * 100)));
  return stage === "convert" ? `動画を整えています ${pct}%` : `上げています ${pct}%`;
}
