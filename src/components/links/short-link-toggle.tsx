"use client";

import Link from "next/link";
import { Term } from "@/components/ui/term";
import { findLinkableUrls, substitutesBodyLinks } from "@/lib/links/rules";
import type { PostLinkPreview } from "@/lib/links/store";
import { isManualSns, SNS, type SnsKey } from "@/lib/sns";

// 作成画面の「ストアのリンクを短縮リンクにする」（docs/architecture.md の 4.22、決定 D20。初期値はオン）
export function ShortLinkToggle({ checked, onChange, projectId }: { checked: boolean; onChange: (v: boolean) => void; projectId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        本文の URL を<Term k="shortLink">短縮リンク</Term>にして、押された回数を数える
      </label>
      <p className="pl-6 text-xs leading-[1.7] text-muted">
        SNS ごとに別のリンクになり、どの SNS から何人がストアなどに来たかがわかります（Instagram は本文の URL を押せないので置き換えません）。数字は
        <Link href={`/projects/${projectId}/links`} className="mx-0.5 text-primary hover:underline">
          リンク
        </Link>
        で見られます。
      </p>
    </div>
  );
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
