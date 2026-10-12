"use client";

import Link from "next/link";
import { Term } from "@/components/ui/term";
import { findLinkableUrls, planShortLinks, substitutesBodyLinks, type ShortLinkPlan } from "@/lib/links/rules";
import type { PostLinkPreview } from "@/lib/links/store";
import { isManualSns, SNS, type SnsKey } from "@/lib/sns";

// 作成画面の「本文の URL を短縮リンクにする」（docs/architecture.md の 4.22、決定 D20。初期値はオン）。
// 本文に URL がないときはチェックを出さず、URL の入れ方と、X ならプロフィールのリンクで数えるのがよいことを案内する（チェックだけ出ていると、短縮リンクが付くと思ってしまうため）。
// URL があるときは、どの URL をどの SNS で置き換えるかを出す
export function ShortLinkToggle({
  checked,
  onChange,
  projectId,
  body,
  targets,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  projectId: string;
  // 共通の本文（送り先を選んでいないときに URL があるかを見る）
  body: string;
  // これから送る SNS と、その文面（投稿済みの SNS は入れない）。選んでいなければ空
  targets: { sns: SnsKey; text: string }[];
}) {
  // 送り先を選んでいれば、その SNS で送る文面（SNS ごとに変えた文面か、共通の本文）を見る
  const hasUrl = (targets.length ? targets.map((t) => t.text) : [body]).some((t) => findLinkableUrls(t).length > 0);
  const plan = planShortLinks(targets);
  const linksPage = (
    <Link href={`/projects/${projectId}/links`} className="text-primary hover:underline">
      短縮リンク
    </Link>
  );
  const profileHint = (
    <>
      X は本文に URL があると 1 本ごとの費用が上がる（約 2 円 → 約 30 円）ので、X で数えるなら、プロフィールに置くリンクを短縮リンクにするのがおすすめです（
      <Link href={`/projects/${projectId}/plan?open=profile#plan-profile-head`} className="text-primary hover:underline">
        アカウント設計の「5 名前とプロフィール」
      </Link>
      から作れます）。
    </>
  );

  // 本文に URL がない: 置き換えるものがないので、チェックは出さない
  if (!hasUrl) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold">
          <Term k="shortLink">短縮リンク</Term>（押された回数を数える）
        </p>
        <p className="text-xs leading-[1.7] text-muted">
          この投稿の本文には URL がないので、短縮リンクは付きません。本文に https:// から始まる URL（ストアのページなど）を入れると、SNS
          ごとの短縮リンクに置き換えて、どの SNS から何人来たかを数えます。
          {profileHint}
        </p>
      </div>
    );
  }

  // 選んだ送り先のどれでも置き換えない（Instagram・手で投稿する SNS だけ）
  if (targets.length > 0 && plan.replaced.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold">
          <Term k="shortLink">短縮リンク</Term>（押された回数を数える）
        </p>
        <p className="text-xs leading-[1.7] text-muted">
          選んだ送り先の {skippedText(plan.skipped)}では本文の URL
          を置き換えないので、この投稿では短縮リンクは付きません。押された回数は、プロフィールに置くリンクを短縮リンクにすると数えられます（
          <Link href={`/projects/${projectId}/plan?open=profile#plan-profile-head`} className="text-primary hover:underline">
            アカウント設計の「5 名前とプロフィール」
          </Link>
          から作れます）。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        {/* label は flex なので、文を 1 つにまとめる（用語の印だけが細い箱になって折れないように） */}
        <span>
          本文の URL を<Term k="shortLink">短縮リンク</Term>
          にして、押された回数を数える
        </span>
      </label>
      <div className="flex flex-col gap-1 pl-6 text-xs leading-[1.7] text-muted">
        {targets.length === 0 ? (
          <p>送り先の SNS を選ぶと、どの SNS で置き換えるかをここに出します。</p>
        ) : (
          <>
            <p>{checked ? "送るときに、SNS ごとに別の短縮リンクに置き換えます:" : "チェックを入れると、送るときに次の SNS で置き換えます:"}</p>
            <ul className="flex flex-col gap-0.5">
              {plan.replaced.map((r) => (
                <li key={r.url}>
                  {/* URL だけを途中で折る（SNS の名前は途中で折らない） */}
                  <span className="break-all text-fg">{r.url}</span> → <span className="inline-block">{r.sns.map((s) => SNS[s].label).join("・")}</span>
                </li>
              ))}
            </ul>
            {plan.skipped.length > 0 && <p>置き換えない: {skippedText(plan.skipped)}</p>}
          </>
        )}
        <p>
          どの SNS から何人がストアなどに来たかは、{linksPage}
          の画面で見られます。
        </p>
      </div>
    </div>
  );
}

// 置き換えない SNS とその理由（例: 「Instagram（本文の URL を押せないため）・note（手で投稿するため）」）
function skippedText(skipped: ShortLinkPlan["skipped"]): string {
  return skipped.map((s) => `${SNS[s.sns].label}（${s.reason === "instagram" ? "本文の URL を押せないため" : "手で投稿するため"}）`).join("・");
}

// 見え方の欄に出す、送るときの置き換え。保存したあとは実際の短縮リンクを出す（送る前に、送る文をそのまま見せるため）
export function ShortLinkPreviewNote({ sns, text, enabled, preview }: { sns: SnsKey; text: string; enabled: boolean; preview: PostLinkPreview }) {
  if (!enabled || isManualSns(sns) || !substitutesBodyLinks(sns)) return null;
  const urls = findLinkableUrls(text);
  if (!urls.length) return null;
  const saved = new Map((preview[sns] ?? []).map((p) => [p.destination, p.url]));
  return (
    <div className="flex flex-col gap-1 text-xs leading-[1.7] text-muted">
      <p>{SNS[sns].label} には、本文の URL を次の短縮リンクに置き換えて送ります:</p>
      <ul className="flex flex-col gap-0.5">
        {urls.map((u) => (
          <li key={u} className="break-all">
            {saved.get(u) ? <b className="text-fg">{saved.get(u)!.replace(/^https:\/\//, "")}</b> : <span>（保存すると決まります）</span>} ← {u}
          </li>
        ))}
      </ul>
    </div>
  );
}
