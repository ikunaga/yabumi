"use client";

import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/media/video-rules";
import { HelpTip } from "@/components/ui/help";
import { VoiceInputButton } from "@/components/ui/voice-input";
import { tabClass, tabListClass } from "@/components/ui/tabs";
import { ShortLinkPreviewNote } from "@/components/links/short-link-toggle";
import { SnsPreview } from "../sns-preview";
import { PREVIEW, PREVIEW_DISCLAIMER } from "@/lib/sns/preview";
import { SNS, hasTitleField, titleLimit, instagramRatioOk, ignoresImages, isManualSns } from "@/lib/sns";
import { formatCount, type Composer } from "./use-composer";

// SNS ごとの見え方と文面（タブ）と、SNS ごとの注意のカード（compose-steps.md。PC は右の列）
export function ComposePreview({ c }: { c: Composer }) {
  const { projectName, accountNames, shownText, linkPreview, images, video, shortLinks, body, overrideRef, overrides, setOverrides, setFocus, titles, setTitles, markTyped, textFor, checks, isLocked, previewSns, focus, focusLabel, hasOverride } = c;
  return (
    <>
      <section aria-label="SNS ごとの見え方と文面" className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 bg-surface2 pr-3">
          <div role="tablist" aria-label="見え方を見る SNS" className={`${tabListClass} min-w-0 flex-1 px-2`}>
            {previewSns.map((sns) => (
              <button key={sns} type="button" role="tab" aria-selected={focus === sns} onClick={() => setFocus(sns)} className={tabClass(focus === sns)}>
                {SNS[sns].label}
                {overrides[sns] !== undefined && (
                  <span className="ml-1">
                    ✎<span className="sr-only">文面を変えています</span>
                  </span>
                )}
              </button>
            ))}
          </div>
          <HelpTip label={`${focusLabel} での出方`} align="right">
            {PREVIEW[focus].note}
            <p className="mt-2">{PREVIEW_DISCLAIMER}</p>
          </HelpTip>
        </div>
        <div role="tabpanel" className="flex flex-col gap-3 px-6 py-5 max-sm:px-4 max-sm:py-4">
          {isManualSns(focus) && <p className="text-[13px] text-muted">{focusLabel} には、「投稿」の画面から手で投稿します。</p>}
          {hasTitleField(focus) && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="target-title" className="text-[13px] font-bold">
                {focusLabel} のタイトル
                {focus === "tiktok" && <span className="ml-1.5 font-normal text-muted">TikTok の写真のタイトル。なくてもよい・90 字まで</span>}
                {focus === "youtube" && <span className="ml-1.5 font-normal text-muted">必須・100 字まで。&lt; と &gt; は使えません</span>}
              </label>
              <input
                id="target-title"
                value={titles[focus] ?? ""}
                maxLength={titleLimit(focus)}
                onChange={(e) => {
                  markTyped();
                  setTitles((t) => ({ ...t, [focus]: e.target.value }));
                }}
                placeholder={focus === "tiktok" || focus === "youtube" ? "例: 日曜の朝だけの食パン" : "例: ひとりでお店を 3 か月続けて気づいたこと"}
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
              />
            </div>
          )}
          <SnsPreview key={focus} sns={focus} text={shownText(focus)} title={titles[focus] ?? null} projectName={projectName} account={accountNames[focus] ?? null} images={images} length={checks[focus].length} />
          <ShortLinkPreviewNote sns={focus} text={textFor(focus)} enabled={shortLinks} preview={linkPreview} />
          {/* 手で投稿する SNS は、利用者が投稿の画面で手で添えるので出さない */}
          {video &&
            !isManualSns(focus) &&
            (SNS[focus].video ? (
              <p className="text-[13px] text-muted">
                ▶ <span className="num">{formatDuration(video.durationMs)}</span> の動画を添えて送ります
              </p>
            ) : (
              <p className="text-[13px] font-semibold text-danger">{focusLabel} には動画を送れません</p>
            ))}
          {images.length > 0 && ignoresImages(focus) && (
            <p className="text-[13px] text-muted">
              {isManualSns(focus) ? `${focusLabel} には、「投稿」の画面で画像を手で添えてください。` : `${focusLabel} は動画だけの SNS です。画像は送りません。`}
            </p>
          )}
          {images.length > SNS[focus].maxImages && !ignoresImages(focus) && (
            <p className="text-[13px] font-semibold text-danger">
              {focusLabel} に添えられる画像は {SNS[focus].maxImages} 枚までです。画像を減らすか、{focusLabel} を送り先から外してください。
            </p>
          )}
          {focus === "instagram" && images.some((i) => !instagramRatioOk(i.width, i.height)) && (
            <p className="text-[13px] font-semibold text-danger">
              Instagram に送れる画像は、縦長 4:5 から横長 1.91:1 までです。
              {images
                .map((i, n) => (instagramRatioOk(i.width, i.height) ? null : `${n + 1} 枚目・${i.width}×${i.height}`))
                .filter(Boolean)
                .join("、")}
              は、この形に入りません。「3 画像・動画」の「縦横を整える」で、切り取るか余白を足してください。
            </p>
          )}
          {focus === "instagram" && checks.instagram.issues.includes("too_many_hashtags") && (
            <p className="text-[13px] font-semibold text-danger">Instagram のハッシュタグは 5 個までです。2025 年 12 月からの決まりです。</p>
          )}
          {hasOverride ? (
            <div className="flex flex-col gap-1.5 border-t border-line pt-3">
              <label htmlFor="override" className="text-[13px] font-bold">
                {focusLabel} 用の文面
              </label>
              <textarea
                id="override"
                ref={overrideRef}
                rows={SNS[focus].needsTitle ? 12 : 4}
                value={overrides[focus]}
                onChange={(e) => {
                  markTyped();
                  setOverrides((o) => ({ ...o, [focus]: e.target.value }));
                }}
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)] max-sm:text-[16px]"
              />
              <VoiceInputButton key={focus} target={overrideRef} label={`${focusLabel} 用の文面`} onChange={(v) => {
                  markTyped();
                  setOverrides((o) => ({ ...o, [focus]: v }));
                }}
              />
              <button
                type="button"
                onClick={() =>
                  setOverrides((o) => {
                    const next = { ...o };
                    delete next[focus];
                    return next;
                  })
                }
                className="self-start text-[13px] font-semibold text-muted underline hover:text-fg"
              >
                共通の文面に戻す
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-t border-line pt-3">
              <Button type="button" variant="secondary" size="sm" disabled={isLocked(focus)} onClick={() => setOverrides((o) => ({ ...o, [focus]: body }))}>
                {focusLabel} だけ文面を変える
              </Button>
              <HelpTip label="SNS ごとの文面">ほかの SNS は共通の文面のままです。</HelpTip>
            </div>
          )}
        </div>
      </section>

      {/* SNS ごとの注意の小さなカード（見本 B の右下）。いま見ている SNS のほかに、選んだ SNS */}
      {previewSns.length > 1 && (
        <ul className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          {previewSns
            .filter((s) => s !== focus)
            .slice(0, 4)
            .map((sns) => (
              <li key={sns}>
                <button
                  type="button"
                  onClick={() => setFocus(sns)}
                  className="flex h-full w-full flex-col gap-0.5 rounded-lg border border-border bg-surface px-4 py-3 text-left hover:border-input"
                >
                  <b className="text-[15px]">{SNS[sns].label}</b>
                  <span className="text-[13px] leading-[1.6] text-muted">
                    {SNS[sns].maxLength ? `${formatCount(SNS[sns].maxLength!)} 字まで・` : ""}
                    {PREVIEW[sns].short}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </>
  );
}
