import { HelpTip } from "@/components/ui/help";
import { SnsTag } from "@/components/ui/marks";
import { REVIEW_FLOW, REVIEW_REASON_DETAIL, REVIEW_REASON_SHORT, STAGE_C_SNS_DETAIL, STAGE_C_SNS_SHORT, isReviewOnlySns, type ReviewOnlySns } from "@/lib/auto-post/labels";
import { SNS, type SnsKey } from "@/lib/sns";

// 「確かめて送る」だけの SNS（X・TikTok・YouTube）が、なぜ自動で送れないか（1 行と「?」）。始める画面の「どこに」の行の下に出す
export function ReviewReason({ sns }: { sns: ReviewOnlySns }) {
  return (
    <p className="w-full text-xs leading-[1.7] text-muted">
      {REVIEW_REASON_SHORT[sns]}{" "}
      <HelpTip label={`${SNS[sns].label}が「確かめて送る」だけの理由`}>{REVIEW_REASON_DETAIL[sns]}</HelpTip>
    </p>
  );
}

// 確かめ待ちになったときの流れ（1 行）。選んだ SNS に「確かめて送る」だけの SNS があれば、その理由を「?」に畳む
export function ReviewFlow({ sns }: { sns: SnsKey[] }) {
  const why = sns.filter(isReviewOnlySns);
  return (
    <p className="w-full text-xs leading-[1.7] text-muted">
      <span className="font-bold">確かめて送る:</span> {REVIEW_FLOW}{" "}
      {why.length > 0 && (
        <HelpTip label="確かめて送る理由">
          {why.map((s) => (
            <span key={s} className="mb-2 block last:mb-0">
              {REVIEW_REASON_DETAIL[s]}
            </span>
          ))}
        </HelpTip>
      )}
    </p>
  );
}

// 段階 A では選べない TikTok・YouTube（1 行と「?」）
export function StageCSns() {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs leading-[1.7] text-muted">
      <span className="inline-flex gap-2">
        <SnsTag sns="tiktok" />
        <SnsTag sns="youtube" />
      </span>
      <p className="min-w-0 flex-1 basis-60">
        {STAGE_C_SNS_SHORT}{" "}
        <HelpTip label="TikTok・YouTube が選べない理由">{STAGE_C_SNS_DETAIL}</HelpTip>
      </p>
    </div>
  );
}
