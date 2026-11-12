"use client";

import Link from "next/link";
import { ImageAttachments } from "../image-attachments";
import { SNS } from "@/lib/sns";
import { type Composer } from "./use-composer";

// ③ 画像: 添える・つくる・整える（compose-steps.md）
export function ComposeStepImages({ c }: { c: Composer }) {
  const { projectId, projectName, needImageReconnect, aiCheckEnabled, images, setImages, selected, pending, bodyFor, isLocked, chosen, focus, clearFieldError, fe, connectHref, markTyped } = c;
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

      <div className="flex flex-col gap-1.5">
        <ImageAttachments
          images={images}
          disabled={pending}
          maker={{ projectId, projectName, aiEnabled: aiCheckEnabled, text: bodyFor(focus), targets: chosen }}
          instagram={chosen.includes("instagram")}
          onChange={(next) => {
            // 画像を添える・つくる・外す・並べ替える・整えるのは、利用者が自分でした作業なので、書きかけに控える（4.62）
            markTyped();
            setImages(next);
            clearFieldError("media");
          }}
        />
        {fe.media && <p className="text-sm font-semibold text-danger">{fe.media}</p>}
      </div>
    </>
  );
}
