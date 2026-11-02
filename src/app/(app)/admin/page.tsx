import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/nav/top-bar";
import { Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/page-header";
import { formatLegalDate, upcomingLegalChange } from "@/lib/legal/version";
import { createAdminClient } from "@/lib/supabase/admin";
import { listWaitlist } from "@/lib/waitlist/store";
import { requireUser } from "@/lib/auth/user";
import { isOperatorEmail } from "@/lib/waitlist/operator";

export const metadata: Metadata = { title: "運営", robots: { index: false } };

// 運営者の画面の入口（OPERATOR_ADMIN_EMAILS のアドレスでログインした人だけ。ほかの人には 404）
export default async function AdminPage() {
  const user = await requireUser();
  if (!isOperatorEmail(user.email)) notFound();
  const [entries, change] = [await listWaitlist(createAdminClient()), upcomingLegalChange()];
  return (
    <>
      <TopBar email={user.email} crumb={<b className="text-fg">運営</b>} mobileBack={{ href: "/projects", title: "運営" }} />
      <main className="flex flex-col gap-5 px-12 py-10 max-lg:px-8 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <PageHeader title="運営" sub="運営者だけ" />
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <Link href="/admin/waitlist" className="group hover:no-underline">
            <Metric
              label={
                <span className="flex items-center gap-1.5">
                  招待の申し込み
                  <span aria-hidden className="text-faint group-hover:text-fg">→</span>
                </span>
              }
              value={entries.length}
              unit="件"
              note="招待する・お断りする"
              className="group-hover:border-input"
            />
          </Link>
          <Link href="/admin/legal-notice" className="group hover:no-underline">
            <Metric
              label={
                <span className="flex items-center gap-1.5">
                  規約の変更の知らせ
                  <span aria-hidden className="text-faint group-hover:text-fg">→</span>
                </span>
              }
              value={change ? formatLegalDate(change.version) : "なし"}
              note={change ? "施行の予定の変更" : "予定の変更はありません"}
              className="group-hover:border-input"
            />
          </Link>
        </div>
      </main>
    </>
  );
}
