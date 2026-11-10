"use client";

import Link from "next/link";
import { HelpTip } from "@/components/ui/help";
import { hasXUrl } from "@/lib/sns";
import { X_PRICE_USD, formatUsd } from "@/lib/sns/x/pricing";
import { Term } from "@/components/ui/term";
import { findUrls, hasProfileLinkLine, type ProfileLinkInfo } from "@/lib/posts/profile-link";
import { type Composer } from "./use-composer";

// ④ リンクのうち、送り先の下に出す注意（X の URL の費用・Instagram のプロフィールのリンク。compose-steps.md。段階 B で ④ にまとめる）
export function ComposeLinkNotices({ c }: { c: Composer }) {
  const { projectId, profileLink, body, selected, overrides, setOverrides, setFocus, igLinked, textFor, isLocked, applyProfileLink, removeXUrl, editOverride } = c;
  return (
    <>
      {selected.has("x") && !isLocked("x") && hasXUrl(textFor("x")) && (
        <XUrlCostNotice
          onEdit={() => {
            setFocus("x");
            setOverrides((o) => (o.x !== undefined ? o : { ...o, x: body }));
          }}
          onRemove={removeXUrl}
        />
      )}

      {selected.has("instagram") && !isLocked("instagram") && (
        <InstagramLinkNotice
          projectId={projectId}
          text={textFor("instagram")}
          info={profileLink}
          done={igLinked && overrides.instagram !== undefined}
          onApply={applyProfileLink}
          onEdit={() => editOverride("instagram")}
        />
      )}
    </>
  );
}

// X は本文に URL があると、API の料金が 13 倍になる（決定 D16）。費用の差は 1 行で出し、URL を外す代わりの案は「?」に畳む
function XUrlCostNotice({ onEdit, onRemove }: { onEdit: () => void; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
      <span className="font-bold text-signal">● 費用</span>
      <span>
        X は本文に URL があると 1 本 {formatUsd(X_PRICE_USD.post_with_url)}（約 30 円。なければ約 2 円）
      </span>
      <HelpTip label="X の URL の費用">
        <ul className="list-disc pl-4">
          <li>
            URL があると、X の <Term k="payPerUse">API の料金</Term>が 1 本 {formatUsd(X_PRICE_USD.post_with_url)}、なければ {formatUsd(X_PRICE_USD.post)} です
          </li>
          <li>URL は X のプロフィールに置き、本文は「プロフィールのリンクから」とする</li>
          <li>X 用に文面を変えて URL を外す（Threads など、ほかの SNS には URL を残せる）</li>
          <li>「example.com」のように https:// を付けなくても、X は URL として数えます</li>
          <li>短縮リンクも URL なので、料金は同じです。X で押された回数は、プロフィールのリンクを短縮リンクにして数えるのがおすすめです</li>
        </ul>
      </HelpTip>
      <button type="button" onClick={onRemove} className="font-semibold underline">
        X だけ URL を外す
      </button>
      <button type="button" onClick={onEdit} className="font-semibold underline">
        X 用に文面を変える
      </button>
    </div>
  );
}

// Instagram は本文の URL を押せない（4.37）。URL があれば知らせて、文面を「プロフィールのリンクから」にするボタンを出す。
// URL がなくても、行き先の URL を登録していれば一言を足すボタンを控えめに。プロフィールに置く短縮リンクがなければ、作る画面への 1 行
function InstagramLinkNotice({
  projectId,
  text,
  info,
  done,
  onApply,
  onEdit,
}: {
  projectId: string;
  text: string;
  info: ProfileLinkInfo | null;
  done: boolean;
  onApply: () => void;
  onEdit: () => void;
}) {
  const hasUrl = findUrls(text).length > 0;
  const hasLine = hasProfileLinkLine(text);
  const canAdd = !hasUrl && !hasLine && text.trim() !== "" && (info?.destinations.length ?? 0) > 0;
  const needLink = info !== null && !info.hasInstagramLink && (hasUrl || hasLine);
  const showDone = done && !hasUrl && hasLine;
  if (!hasUrl && !showDone && !canAdd && !needLink) return null;
  return (
    <div className="flex flex-col gap-1 text-[13px] leading-[1.7]">
      {hasUrl && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-bold text-signal">● 要確認</span>
          <span>Instagram では本文の URL は押せません</span>
          <button type="button" onClick={onApply} className="text-left font-semibold underline">
            Instagram の文面を「プロフィールのリンクから」にする
          </button>
        </p>
      )}
      {showDone && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            <span aria-hidden className="mr-1 font-bold text-success">
              ✓
            </span>
            Instagram 用の文面の URL を外し、最後に「{text.split("\n").find(hasProfileLinkLine)?.trim()}」を入れました。
          </span>
          <button type="button" onClick={onEdit} className="font-semibold underline">
            Instagram 用の文面を直す
          </button>
        </p>
      )}
      {canAdd && (
        <p className="text-muted">
          <button type="button" onClick={onApply} className="text-left underline hover:text-fg">
            Instagram の文面に「プロフィールのリンクから」の一言を足す
          </button>
        </p>
      )}
      {needLink && (
        <p className="text-muted">
          Instagram のプロフィールに置くリンクがまだありません。
          <Link href={`/projects/${projectId}/links#profile-instagram`} className="font-semibold text-fg underline">
            プロフィールに置くリンクを作る（短縮リンク）
          </Link>
          （作ったら、Instagram のプロフィールに自分で貼ります）
        </p>
      )}
    </div>
  );
}
