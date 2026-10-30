import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LegalNoticeSend } from "@/components/admin/legal-notice-send";
import { TopBar } from "@/components/nav/top-bar";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/user";
import { dailyLimit, docsLabel, noticeProgress } from "@/lib/legal/notice-mail";
import { formatLegalDate, noticeStarted, upcomingLegalChange } from "@/lib/legal/version";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOperatorEmail } from "@/lib/waitlist/operator";

export const metadata: Metadata = { title: "規約の変更の知らせ", robots: { index: false } };

// 運営者の画面: 利用規約・プライバシーポリシーの予定の変更を、登録している全員にメールで知らせる（決定 D31。docs/architecture.md の 4.30）。
// OPERATOR_ADMIN_EMAILS のアドレスでログインした人だけ。ほかの人には、ないページ（404）と同じに見せる
export default async function LegalNoticeAdminPage() {
  const user = await requireUser();
  if (!isOperatorEmail(user.email)) notFound();
  const change = upcomingLegalChange();
  const progress = change ? await noticeProgress(createAdminClient(), change.version) : null;
  const ready = change ? noticeStarted(change) : false;

  return (
    <>
      <TopBar
        email={user.email}
        crumb={
          <span className="flex items-center gap-2">
            <Link href="/admin" className="hover:text-fg hover:underline">
              運営
            </Link>
            <span className="text-muted">/</span>
            <b className="text-fg">規約の変更の知らせ</b>
          </span>
        }
        mobileBack={{ href: "/admin", title: "規約の変更の知らせ" }}
      />
      <main className="flex flex-col gap-5 px-12 py-10 max-lg:px-8 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <PageHeader
          title="規約の変更の知らせ"
          sub={`1 日に ${dailyLimit()} 通まで`}
          help={`利用規約・プライバシーポリシーの予定の変更（src/lib/legal/version.ts の LEGAL_VERSIONS に足した、施行日が先の版）を、登録している全員にメールで知らせます。伴走のメールを止めた人にも送ります。1 日に送るのは ${dailyLimit()} 通までで、残りは毎日 9:10 のジョブが続きを送ります。手順は docs/legal.md の「②の段取り」。`}
        />
        {!change ? (
          <Card className="overflow-hidden">
            <EmptyState title="予定の変更はありません" description="LEGAL_VERSIONS に施行日が先の版を足してデプロイすると、ここに出ます。" />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <CardHeader title={`${formatLegalDate(change.version)} 施行の${docsLabel(change)}の変更`} />
            <div className="flex flex-col gap-4 px-6 pb-5 text-[15px] leading-[1.8] max-sm:px-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted">知らせ始める日</dt>
                <dd>{change.noticeFrom ? formatLegalDate(change.noticeFrom) : "（未定）"}</dd>
                <dt className="text-muted">種類</dt>
                <dd>{change.adverse ? "利用者に不利な変更（30 日以上前に知らせる）" : "利用者に不利でない変更（14 日以上前に知らせる）"}</dd>
                <dt className="text-muted">変わる点</dt>
                <dd>
                  <ul className="list-disc pl-5">
                    {change.summary.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </dd>
              </dl>
              {progress && (
                <p className="rounded-md bg-surface2 px-4 py-3">
                  登録している人 {progress.recipients} 人 ・ 送った {progress.sent} ・ 送れなかった {progress.failed} ・ まだ {progress.remaining}
                  {progress.started ? (progress.finished ? "（送り終えました）" : "（送っています）") : "（まだ送り始めていません）"}
                </p>
              )}
              {!ready ? (
                <p className="text-muted">知らせ始める日の前です。その日から送れます（ページのお知らせと、ログイン後の帯も、その日から出ます）。</p>
              ) : progress && !progress.finished ? (
                <LegalNoticeSend started={progress.started} remaining={progress.remaining} />
              ) : null}
            </div>
          </Card>
        )}
      </main>
    </>
  );
}
