import { cookies } from "next/headers";
import Link from "next/link";
import { docsLabel } from "@/lib/legal/notice-mail";
import { LEGAL_NOTICE_COOKIE } from "@/lib/legal/notice-cookie";
import { formatLegalDate, legalBannerChange } from "@/lib/legal/version";
import { LegalNoticeDismiss } from "./legal-notice-dismiss";

// ログイン後のすべての画面の上に出す「利用規約・プライバシーポリシーが ○月○日に変わります」の帯（決定 D31。docs/architecture.md の 4.30）。
// 予定の変更があり、知らせ始める日を過ぎていて、施行日の前のときだけ。閉じたら、その変更（版）については出さない（cookie）
export async function LegalNoticeBanner({ now = new Date() }: { now?: Date }) {
  const jar = await cookies();
  const change = legalBannerChange(now, jar.get(LEGAL_NOTICE_COOKIE)?.value);
  if (!change) return null;
  const doc = change.docs[0];
  return (
    <div role="region" aria-label="規約の変更のお知らせ" className="border-b border-line bg-primary-soft">
      <div className="flex items-start gap-3 px-6 py-2.5 text-[14px] leading-[1.7] max-sm:px-4">
        <p className="flex-1">
          <b>
            {docsLabel(change)}が{formatLegalDate(change.version)}に変わります。
          </b>{" "}
          <span className="text-muted max-sm:hidden">{change.summary[0]}</span>{" "}
          <Link href={`/${doc}#legal-notice`} className="font-semibold whitespace-nowrap text-primary hover:underline">
            変更のお知らせを見る
          </Link>
        </p>
        <LegalNoticeDismiss version={change.version} />
      </div>
    </div>
  );
}
