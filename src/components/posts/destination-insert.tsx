"use client";

import Link from "next/link";
import { useState } from "react";
import { projectSettingsHref } from "@/lib/projects/paths";
import type { ProfileLinkDestination } from "@/lib/posts/profile-link";

// 作成画面の「行き先の URL を入れる」（docs/architecture.md の 4.40）。短縮リンクの行の「本文に URL がありません」の横に置く。
// 行き先が 1 つなら押してすぐ入れ、2 つ以上なら選ぶ。行き先がなければ、プロジェクトの設定へ案内する
export function DestinationInsert({
  projectId,
  destinations,
  onInsert,
}: {
  projectId: string;
  destinations: ProfileLinkDestination[];
  onInsert: (url: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const linkClass = "text-[13px] font-semibold text-fg underline underline-offset-2";

  if (destinations.length === 0) {
    return (
      <Link href={`${projectSettingsHref(projectId)}#destinations`} className={linkClass}>
        プロジェクトの設定で行き先の URL を足す
      </Link>
    );
  }
  if (destinations.length === 1) {
    return (
      <button type="button" onClick={() => onInsert(destinations[0].url)} className={`${linkClass} text-left`}>
        行き先の URL を入れる
      </button>
    );
  }
  return (
    <>
      <button type="button" aria-expanded={choosing} aria-controls="destination-choices" onClick={() => setChoosing((c) => !c)} className={`${linkClass} text-left`}>
        行き先の URL を入れる
        <span aria-hidden className={`ml-1 inline-block text-[10px] text-muted transition-transform ${choosing ? "rotate-180" : ""}`}>
          ▼
        </span>
      </button>
      {choosing && (
        <ul id="destination-choices" aria-label="入れる行き先" className="flex basis-full flex-col gap-1.5 rounded-md border border-line bg-surface2 p-2">
          {destinations.map((d) => (
            <li key={d.url}>
              <button
                type="button"
                onClick={() => {
                  setChoosing(false);
                  onInsert(d.url);
                }}
                className="flex w-full min-w-0 flex-col items-start rounded-sm px-2.5 py-1.5 text-left hover:bg-primary-soft"
              >
                <span className="text-[14px] font-semibold">{d.label ?? d.url}</span>
                <span className="w-full truncate text-xs text-muted">{d.url}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
