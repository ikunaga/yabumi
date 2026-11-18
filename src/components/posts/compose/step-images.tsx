"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ImageAttachments } from "../image-attachments";
import { VideoAttachment } from "../video-attachment";
import { SNS } from "@/lib/sns";
import { formatDuration } from "@/lib/media/video-rules";
import { VIDEO_REMOVED_TEXT } from "@/lib/posts/compose-steps";
import { type Composer } from "./use-composer";
import { FormatImageBand } from "./format-image-band";
import { formatPhotoTexts, type FormatPhotoPreset } from "@/lib/post-formats/image";

// ③ 画像・動画: 添える・つくる・整える（compose-steps.md）。1 つの投稿は、画像か動画 1 本のどちらか（docs/design/video.md の 4.）
export function ComposeStepImages({ c }: { c: Composer }) {
  const { projectId, projectName, postId, initial, needImageReconnect, aiCheckEnabled, images, setImages, video, setVideo, videoBusy, setVideoBusy, videoRemovedBlocks, selected, pending, bodyFor, isLocked, chosen, focus, clearFieldError, fe, connectHref, markTyped, checks } = c;
  const videoInputRef = useRef<HTMLInputElement>(null);
  // 投稿のフォーマットの画像（docs/design/format-image.md の 2.1）。帯の「つくる」で、画像をつくる画面に渡す
  const { formatUse } = c;
  const [preset, setPreset] = useState<FormatPhotoPreset | null>(null);
  // 下書きから開き直したとき、フォーマットの欄は空なので、投稿に結びついたシリーズの記録の言葉を使う（欄に何か入れたらそちらを使う）
  const restored = formatUse && formatUse.format.id === initial.formatId && !Object.values(formatUse.values).some((v) => v.trim()) && !formatUse.answer?.trim() ? initial.formatValues : null;
  const imageUse = formatUse?.format.image ? { ...formatUse, ...(restored ?? {}), format: { ...formatUse.format, image: formatUse.format.image } } : null;
  // フォーマットの画像の設定を、画像をつくる画面に渡す（auto: すぐ 1 枚つくる。帯の「つくる」だけ）
  function makePreset(auto: boolean, texts: { text: string; headline: string | null }) {
    if (!imageUse) return;
    setPreset((p) => ({
      seq: (p?.seq ?? 0) + 1,
      auto,
      formatId: imageUse.format.id,
      name: imageUse.format.name,
      scene: imageUse.format.image.scene,
      text: texts.text,
      values: imageUse.values,
      answer: imageUse.answer ?? "",
      style: imageUse.format.image.style,
      size: imageUse.format.image.size,
      headline: texts.headline,
    }));
  }
  // 動画を添えたが、yabumi からはまだ動画を送れない送り先
  const noVideo = video ? chosen.filter((s) => !isLocked(s) && checks[s].issues.includes("video_unsupported")) : [];
  return (
    <>
      {images.length > 0 && needImageReconnect.some((s) => selected.has(s) && !isLocked(s)) && (
        <p className="text-[13px] leading-[1.7]">
          <span className="mr-1.5 font-bold text-signal">● 要確認</span>
          {needImageReconnect.filter((s) => selected.has(s)).map((s) => SNS[s].label).join("・")} に画像を送るには、つなぎ直しが要ります。
          <Link href={connectHref} className="ml-1 font-semibold underline">
            つないだ SNS へ
          </Link>
        </p>
      )}
      {noVideo.length > 0 && (
        <p className="text-[13px] leading-[1.7]">
          <span className="mr-1.5 font-bold text-signal">● 要確認</span>
          {noVideo.map((s) => SNS[s].label).join("・")} には動画を送れません。{noVideo.map((s) => SNS[s].label).join("・")} を送り先から外すか、動画を外してください。
        </p>
      )}
      {videoRemovedBlocks ? (
        <p className="text-[13px] leading-[1.7]">
          <span className="mr-1.5 font-bold text-signal">● 要確認</span>
          {VIDEO_REMOVED_TEXT}（前の動画は <span className="num">{formatDuration(initial.videoRemoved!.durationMs)}</span>）。
        </p>
      ) : (
        !video &&
        initial.videoRemoved && (
          <p className="text-[13px] text-muted">
            動画（<span className="num">{formatDuration(initial.videoRemoved.durationMs)}</span>）は送り終えたので消しました。
          </p>
        )
      )}

      {imageUse && (
        <FormatImageBand
          use={imageUse}
          disabled={pending || videoBusy || Boolean(video)}
          onMake={makePreset}
        />
      )}
      <div className="flex flex-col gap-1.5">
        <ImageAttachments
          preset={preset}
          // 帯を使わずに「画像をつくる」を押したときも、はじめの 1 回はフォーマットの画像の設定（絵の説明・描き方・縦横）を入れて開く。
          // つくるのは押したときだけ（指摘 18。押していないのに AI を呼ばない）
          onOpenMaker={() => {
            if (imageUse && !preset) makePreset(false, formatPhotoTexts(imageUse.format, imageUse.values, imageUse.answer));
          }}
          images={images}
          disabled={pending || videoBusy}
          maker={{ projectId, projectName, aiEnabled: aiCheckEnabled, text: bodyFor(focus), targets: chosen }}
          instagram={chosen.includes("instagram")}
          addBlocked={video ? "動画を外すと画像を選べます" : null}
          buttonsNote={images.length > 0 ? "画像を外すと動画を選べます" : null}
          extraButtons={
            <Button type="button" variant="secondary" size="sm" disabled={pending || videoBusy || images.length > 0} onClick={() => videoInputRef.current?.click()}>
              動画を選ぶ
            </Button>
          }
          onChange={(next) => {
            // 画像を添える・つくる・外す・並べ替える・整えるのは、利用者が自分でした作業なので、書きかけに控える（4.62）
            markTyped();
            setImages(next);
            clearFieldError("media");
          }}
        />
        <VideoAttachment
          video={video}
          postId={postId}
          inputRef={videoInputRef}
          disabled={pending}
          onBusyChange={setVideoBusy}
          onChange={(next) => {
            markTyped();
            setVideo(next);
            clearFieldError("media");
          }}
        />
        {fe.media && <p className="text-sm font-semibold text-danger">{fe.media}</p>}
      </div>
    </>
  );
}
