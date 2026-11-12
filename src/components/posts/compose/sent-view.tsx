"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { tabClass, tabListClass } from "@/components/ui/tabs";
import { SNS, type SnsKey } from "@/lib/sns";
import { SnsPreview } from "../sns-preview";
import { type Composer } from "./use-composer";

// すべて送った投稿（docs/design/compose-steps.md の 6.）: 決めることが残っていないので、ステップに分けずに送った文面を読むだけにする。
// 送った結果・取り消すは上の「送信の結果」、数字は下の帯。ほかの SNS にも送るときは「ほかの SNS にも送る」で ② から
export function ComposeSentView({ c, onExtend }: { c: Composer; onExtend: () => void }) {
  const { chosen, isLocked, shownText, titles, projectName, accountNames, images, checks, deleteRow } = c;
  const sent = chosen.filter((s) => isLocked(s));
  const [tab, setTab] = useState<SnsKey | null>(null);
  const focus = tab && sent.includes(tab) ? tab : sent[0];
  // まだ送っていない SNS（ほかの SNS にも送れる）
  const more = (Object.keys(SNS) as SnsKey[]).some((s) => !isLocked(s));
  return (
    <section aria-labelledby="sent-heading" className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
      <h2 id="sent-heading" className="text-[18px] font-bold max-sm:text-[16px]">
        送った文面
      </h2>
      {sent.length > 1 && (
        <div role="tablist" aria-label="送った SNS" className={tabListClass}>
          {sent.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={focus === s} onClick={() => setTab(s)} className={tabClass(focus === s)}>
              {SNS[s].label}
            </button>
          ))}
        </div>
      )}
      {focus && (
        <div role={sent.length > 1 ? "tabpanel" : undefined}>
          <SnsPreview key={focus} sns={focus} text={shownText(focus)} title={titles[focus] ?? null} projectName={projectName} account={accountNames[focus] ?? null} images={images} length={checks[focus].length} />
        </div>
      )}
      <p className="text-[14px] leading-[1.7] text-muted">送った投稿です。直すときは各 SNS で、取り消すときは上の「送信の結果」から。</p>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
        {more && (
          <>
            <Button type="button" variant="secondary" size="sm" onClick={onExtend}>
              ほかの SNS にも送る
            </Button>
            <span className="text-xs text-muted">送った SNS には送り直しません</span>
          </>
        )}
        {deleteRow(true)}
      </div>
    </section>
  );
}
