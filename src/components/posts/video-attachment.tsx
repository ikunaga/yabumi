"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/media/rules";
import { MAX_VIDEO_MS, formatDuration } from "@/lib/media/video-rules";
import { clampRange, defaultRange, progressLabel, type VideoRange } from "@/lib/media/video-plan";
import { checkVideoUploadAllowed, discardVideo, videoPlaybackUrl, type AttachedVideo } from "@/lib/media/video-actions";
import type { Prepared } from "@/lib/media/video-convert";

// 投稿に動画を 1 本添える（docs/design/video.md の 2.・4.。2026-11-15 PM が見た目を了承）。
// 選ぶ → 読み取る → 90 秒を超えるなら範囲を選ぶ → この端末で整える → 上げる → 確かめる。「動画を選ぶ」のボタンは画像の枠の中に置き、
// このファイルの input を inputRef で押す。作り直しと上げる部品は、選んだときに読み込む

type Stage =
  | { kind: "idle" }
  // message: 範囲を選ぶ理由（90 秒以下でも、整えると大きすぎたとき）
  | { kind: "range"; file: File; prepared: Prepared; range: VideoRange; previewUrl: string; message?: string }
  | { kind: "busy"; stage: "convert" | "upload" | "confirm" | "stopping"; ratio: number };

export function VideoAttachment({
  video,
  onChange,
  inputRef,
  postId,
  disabled,
  onBusyChange,
}: {
  video: AttachedVideo | null;
  onChange: (next: AttachedVideo | null) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  // 保存した投稿の id（あとから開いたときに、押して再生する URL を作る）
  postId: string | null;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  // 添えた動画が変わったら（添えた・外した・選び直した）、前の動画で出た文は消す（2026-11-15 PMO の再確認 r07）
  const [errorFor, setErrorFor] = useState(video?.id ?? null);
  if ((video?.id ?? null) !== errorFor) {
    setErrorFor(video?.id ?? null);
    setError(null);
  }
  const abortRef = useRef<AbortController | null>(null);
  const busy = stage.kind === "busy";

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // 整えている・上げている間に画面を離れようとしたら、ブラウザの確かめを出す（途中の作業が消えるため）
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  // 画面を閉じたら、途中の作業をやめる
  useEffect(() => () => abortRef.current?.abort(), []);

  async function pick(file: File) {
    setError(null);
    try {
      // 上限（月の本数・置ける量・添えていない本数・確かめ待ち）は、整える前に確かめる（整え終わってから断らない）
      const allowed = await checkVideoUploadAllowed();
      if (allowed.error) {
        setError(allowed.error);
        return;
      }
      const { probeVideo, VideoPrepError } = await import("@/lib/media/video-convert");
      let prepared: Prepared;
      try {
        prepared = await probeVideo(file);
      } catch (e) {
        setError(e instanceof VideoPrepError ? e.userMessage : "この動画は読み取れませんでした。別の動画を選んでください。");
        return;
      }
      const range = defaultRange(prepared.probe.durationMs);
      if (prepared.probe.durationMs > MAX_VIDEO_MS) {
        setStage({ kind: "range", file, prepared, range, previewUrl: URL.createObjectURL(file) });
        return;
      }
      await prepare(file, prepared, range);
    } catch (e) {
      console.error("[video]", e instanceof Error ? e.message : e);
      setError("動画を読み込めませんでした。通信のよいところで、もう一度お試しください。");
    }
  }

  async function prepare(file: File, prepared: Prepared, range: VideoRange) {
    const ac = new AbortController();
    abortRef.current = ac;
    setStage({ kind: "busy", stage: "convert", ratio: 0 });
    try {
      const [{ convertVideo, VideoPrepError }, { uploadVideoBlob, VideoUploadError }] = await Promise.all([import("@/lib/media/video-convert"), import("@/lib/media/video-upload")]);
      let blob: Blob;
      try {
        blob = await convertVideo(file, prepared, range, { signal: ac.signal, onProgress: (ratio) => !ac.signal.aborted && setStage({ kind: "busy", stage: "convert", ratio }) });
      } catch (e) {
        // 整えると 50MB を超えた: 短くする手段として、範囲を選ぶ欄を出す（90 秒以下でも）
        if (e instanceof VideoPrepError && e.code === "too_large") {
          setStage({ kind: "range", file, prepared, range, previewUrl: URL.createObjectURL(file), message: e.userMessage });
          return;
        }
        if (e instanceof VideoPrepError) setError(e.userMessage);
        else if (!(e instanceof DOMException && e.name === "AbortError")) setError("動画を整えられませんでした。もう一度お試しください。");
        setStage({ kind: "idle" });
        return;
      }
      setStage({ kind: "busy", stage: "upload", ratio: 0 });
      try {
        const up = await uploadVideoBlob(blob, {
          signal: ac.signal,
          onProgress: (ratio) => !ac.signal.aborted && setStage({ kind: "busy", stage: "upload", ratio }),
          // 上げ終えたら「やめる」を隠す（サーバーの確かめは数秒で終わる）
          onUploaded: () => setStage({ kind: "busy", stage: "confirm", ratio: 1 }),
        });
        // 前に添えていた、まだ保存していない動画は外す（保存した投稿の動画は、保存したときに消える）
        if (video) void discardVideo(video.id);
        onChange({ id: up.id, durationMs: up.durationMs, sizeBytes: up.sizeBytes, localUrl: URL.createObjectURL(blob) });
      } catch (e) {
        if (e instanceof VideoUploadError) setError(e.userMessage);
        else if (!(e instanceof DOMException && e.name === "AbortError")) setError("動画を上げられませんでした。もう一度お試しください。");
      }
      setStage({ kind: "idle" });
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }

  function cancelRange() {
    if (stage.kind === "range") URL.revokeObjectURL(stage.previewUrl);
    setStage({ kind: "idle" });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void pick(file);
        }}
      />

      {stage.kind === "range" && (
        <RangePicker
          message={stage.message}
          durationMs={stage.prepared.probe.durationMs}
          previewUrl={stage.previewUrl}
          range={stage.range}
          onRange={(range) => setStage({ ...stage, range })}
          onCancel={cancelRange}
          onConfirm={() => {
            URL.revokeObjectURL(stage.previewUrl);
            void prepare(stage.file, stage.prepared, stage.range);
          }}
        />
      )}

      {stage.kind === "busy" && (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3.5 py-3">
          <div className="flex items-center gap-3">
            <span className="num text-sm font-semibold">{progressLabel(stage.stage, stage.ratio)}</span>
            {stage.stage !== "confirm" && stage.stage !== "stopping" && (
              <Button
                type="button"
                variant="text"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  // 押したらすぐ「やめています…」にする（「やめる」は隠す）
                  setStage({ kind: "busy", stage: "stopping", ratio: stage.ratio });
                  abortRef.current?.abort();
                }}
              >
                やめる
              </Button>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface2" aria-hidden>
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(stage.ratio * 100)}%` }} />
          </div>
          <p className="text-[13px] text-muted">終わるまで、この画面を開いたままにしてください</p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {video && stage.kind !== "busy" && (
        <VideoRow
          video={video}
          postId={postId}
          disabled={disabled}
          onRemove={() => {
            void discardVideo(video.id);
            onChange(null);
          }}
        />
      )}
    </div>
  );
}

// 添えた動画の 1 行（左の箱を押すと、その場で再生する。最初は読み込まない）
function VideoRow({ video, postId, disabled, onRemove }: { video: AttachedVideo; postId: string | null; disabled?: boolean; onRemove: () => void }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-3 rounded-lg border border-border bg-surface p-2.5 max-sm:grid-cols-[64px_1fr]">
      <VideoBox video={video} postId={postId ?? undefined} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="font-bold text-fg">動画</span>
          <span className="num">
            {formatDuration(video.durationMs)}・{formatBytes(video.sizeBytes)}
          </span>
          <span className="ml-auto">
            <button type="button" disabled={disabled} onClick={onRemove} className="text-muted hover:text-fg hover:underline">
              外す
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

// 9:16 の箱。押すと再生する（上げた直後は手元の動画、あとから開いたときは押したときに署名 URL を作る）
export function VideoBox({ video, postId }: { video: Pick<AttachedVideo, "durationMs" | "localUrl"> & { id?: string }; postId?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (src) {
    return <video src={src} controls autoPlay playsInline preload="none" className="aspect-[9/16] w-full rounded-md bg-surface2 object-contain" />;
  }
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-label={`動画を再生する（${formatDuration(video.durationMs)}）`}
        onClick={async () => {
          if (video.localUrl) return setSrc(video.localUrl);
          if (!postId) return setFailed("保存すると再生できます。");
          const r = await videoPlaybackUrl(postId);
          if (r.url) setSrc(r.url);
          else setFailed(r.error ?? "動画を読めませんでした。");
        }}
        className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-1 rounded-md bg-surface2 text-muted hover:text-fg"
      >
        <span aria-hidden className="text-lg">
          ▶
        </span>
        <span className="num text-xs">{formatDuration(video.durationMs)}</span>
      </button>
      {failed && <span className="text-[11px] text-muted">{failed}</span>}
    </div>
  );
}

// 90 秒を超える動画の、使う範囲を選ぶ欄
function RangePicker({
  message,
  durationMs,
  previewUrl,
  range,
  onRange,
  onCancel,
  onConfirm,
}: {
  message?: string;
  durationMs: number;
  previewUrl: string;
  range: VideoRange;
  onRange: (r: VideoRange) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const seconds = Math.floor(durationMs / 1000);
  const move = (which: "start" | "end", value: number) => {
    const next = clampRange(which === "start" ? { ...range, startMs: value * 1000 } : { ...range, endMs: value * 1000 }, durationMs, which);
    onRange(next);
    if (videoRef.current) videoRef.current.currentTime = (which === "start" ? next.startMs : next.endMs) / 1000;
  };
  const length = Math.round((range.endMs - range.startMs) / 1000);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3.5">
      <video ref={videoRef} src={previewUrl} controls playsInline preload="metadata" className="max-h-[320px] w-full rounded-md bg-surface2 object-contain" />
      <p className="text-sm">
        {message ?? (
          <>
            <span className="num">{formatDuration(durationMs)}</span> の動画です。使う 90 秒を選んでください
          </>
        )}
      </p>
      {(["start", "end"] as const).map((which) => (
        <label key={which} className="grid grid-cols-[3.5rem_1fr_3rem] items-center gap-3 text-sm">
          <span className="text-muted">{which === "start" ? "始まり" : "終わり"}</span>
          <input
            type="range"
            min={0}
            max={seconds}
            step={1}
            value={Math.round((which === "start" ? range.startMs : range.endMs) / 1000)}
            onChange={(e) => move(which, Number(e.target.value))}
            className="w-full accent-primary"
            aria-valuetext={formatDuration(which === "start" ? range.startMs : range.endMs)}
          />
          <span className="num text-right">{formatDuration(which === "start" ? range.startMs : range.endMs)}</span>
        </label>
      ))}
      <p className="num text-sm font-semibold">
        {formatDuration(range.startMs)}〜{formatDuration(range.endMs)}（{length} 秒）を使います
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="text" onClick={onCancel}>
          やめる
        </Button>
        <Button type="button" onClick={onConfirm}>
          この範囲で整える
        </Button>
      </div>
    </div>
  );
}
