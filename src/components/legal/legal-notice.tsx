import { docsLabel } from "@/lib/legal/notice-mail";
import { formatLegalDate, noticeStarted, publishedHistory, upcomingLegalChange } from "@/lib/legal/version";

const DOC_LABEL = { terms: "利用規約", privacy: "プライバシーポリシー" } as const;

// 利用規約・プライバシーポリシーの先頭の「変更のお知らせ」（決定 D31。docs/architecture.md の 4.30）。
// 予定の変更があり、知らせ始める日を過ぎていて、施行日の前のときだけ出す。施行日を過ぎると自動で消え、改定の履歴に移る
export function LegalChangeNotice({ now = new Date() }: { now?: Date }) {
  const change = upcomingLegalChange(now);
  if (!change || !noticeStarted(change, now)) return null;
  return (
    <section id="legal-notice" aria-labelledby="legal-notice-title" className="flex scroll-mt-6 flex-col gap-2 rounded-lg border border-primary bg-primary-soft px-5 py-4 text-[15px] leading-[1.8] max-sm:px-4">
      <h2 id="legal-notice-title" className="font-bold text-primary">
        変更のお知らせ（{formatLegalDate(change.version)}から）
      </h2>
      <p>
        {formatLegalDate(change.version)}から、{docsLabel(change)}を次のとおり変更します。それまでは、このページのいまの文が有効です。
      </p>
      <ul className="list-disc pl-5">
        {change.summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <p className="text-[14px] text-muted">
        {formatLegalDate(change.version)}以降に矢書を使い続けると、変更後の{docsLabel(change)}に同意したものとして扱います。同意できない場合は、それまでに「アカウント」の画面から退会できます。
      </p>
    </section>
  );
}

// ページの末尾の「改定の履歴」（施行済みの版。新しい順）
export function LegalHistory({ now = new Date() }: { now?: Date }) {
  const history = publishedHistory(now).toReversed();
  return (
    <section aria-labelledby="legal-history-title" className="flex flex-col gap-2 border-t border-line pt-6 text-[14px] leading-[1.8]">
      <h2 id="legal-history-title" className="font-bold">
        改定の履歴
      </h2>
      <ul className="flex flex-col gap-1">
        {history.map((r) => (
          <li key={r.version} className="grid grid-cols-[auto_1fr] gap-x-4">
            <span className="text-muted">{formatLegalDate(r.version)}</span>
            <span>
              {r.docs.map((d) => DOC_LABEL[d]).join("・")}: {r.summary.join("。")}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">前の版の全文は、お問い合わせいただければお出しします。</p>
    </section>
  );
}
