"use client";

import type { ReactNode } from "react";

import Link from "next/link";
import { HelpTip } from "@/components/ui/help";
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
  insert,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  projectId: string;
  // 共通の本文（送り先を選んでいないときに URL があるかを見る）
  body: string;
  // これから送る SNS と、その文面（投稿済みの SNS は入れない）。選んでいなければ空
  targets: { sns: SnsKey; text: string }[];
  // 本文に URL がないときに、行の中に出す「行き先の URL を入れる」（4.40）
  insert?: ReactNode;
}) {
  // 送り先を選んでいれば、その SNS で送る文面（SNS ごとに変えた文面か、共通の本文）を見る
  const hasUrl = (targets.length ? targets.map((t) => t.text) : [body]).some((t) => findLinkableUrls(t).length > 0);
  const plan = planShortLinks(targets);
  const linksPage = (
    <Link href={`/projects/${projectId}/links`} className="underline">
      短縮リンク
    </Link>
  );
  const profileHint = (
    <>
      X は本文に URL があると 1 本ごとの費用が上がる（約 2 円 → 約 30 円）ので、X で数えるなら、プロフィールに置くリンクを短縮リンクにするのがおすすめです（
      <Link href={`/projects/${projectId}/plan?open=profile#plan-profile-head`} className="underline">
        アカウント設計の「5 名前とプロフィール」
      </Link>
      から作れます）。
    </>
  );

  // 見本 B の「UTM を自動付与」の位置に置く 1 行（2026-10-30 の PM の回答）。説明は「?」に畳む
  const row = (control: ReactNode, note: ReactNode, help: ReactNode, extra?: ReactNode) => (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px]">
      {control}
      <span className="text-[13px] text-faint">{note}</span>
      <HelpTip label="短縮リンク">
        {help}
        <p className="mt-2">{KINDS_NOTE}</p>
      </HelpTip>
      {extra}
    </div>
  );
  const label = (
    <span>
      <Term k="shortLink">短縮リンク</Term>で押された回数を数える
    </span>
  );

  // 本文に URL がない: 置き換えるものがないので、切り替えは出さない
  if (!hasUrl) {
    return row(
      <span className="text-muted">{label}</span>,
      "本文に URL がありません",
      <>
        本文に https:// から始まる URL（サイト・予約・お店・ストアのページなど）を入れると、SNS ごとの短縮リンクに置き換えて、どの SNS から何人来たかを数えます。
        {profileHint}
      </>,
      insert,
    );
  }

  // 選んだ送り先のどれでも置き換えない（Instagram・手で投稿する SNS だけ）
  if (targets.length > 0 && plan.replaced.length === 0) {
    return row(
      <span className="text-muted">{label}</span>,
      "この送り先では付きません",
      <>
        選んだ送り先の {skippedText(plan.skipped)}では本文の URL を置き換えません。押された回数は、プロフィールに置くリンクを短縮リンクにすると数えられます（
        <Link href={`/projects/${projectId}/plan?open=profile#plan-profile-head`} className="underline">
          アカウント設計の「5 名前とプロフィール」
        </Link>
        から作れます）。
      </>,
    );
  }

  return row(
    <label className="flex cursor-pointer items-center gap-2.5">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-input transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-surface after:transition-transform checked:bg-primary checked:after:translate-x-4"
      />
      {label}
    </label>,
    targets.length === 0 ? "送り先を選ぶと決まります" : plan.replaced.flatMap((r) => r.sns).filter((s, i, a) => a.indexOf(s) === i).map((s) => SNS[s].label).join("・"),
    <>
      {targets.length === 0 ? (
        <p>送り先の SNS を選ぶと、どの SNS で置き換えるかが決まります。</p>
      ) : (
        <>
          <p>{checked ? "送るときに、SNS ごとに別の短縮リンクに置き換えます:" : "オンにすると、送るときに次の SNS で置き換えます:"}</p>
          <ul>
            {plan.replaced.map((r) => (
              <li key={r.url}>
                <span className="break-all">{r.url}</span> → <span className="inline-block">{r.sns.map((s) => SNS[s].label).join("・")}</span>
              </li>
            ))}
          </ul>
          {plan.skipped.length > 0 && <p>置き換えない: {skippedText(plan.skipped)}</p>}
        </>
      )}
      <p>どの SNS から何人が行き先（サイト・予約・お店・ストアなど）に来たかは、{linksPage}の画面で見られます。</p>
    </>,
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

// 短縮リンクの画面の 2 つの違い（投稿をつくるで迷わないように。4.40）
const KINDS_NOTE = "短縮リンクの画面の「プロフィールに置くリンク」は、SNS のプロフィールに自分で貼るもの。「投稿の本文から作ったリンク」は、本文の URL を送るときに自動で置き換えたものです。";
