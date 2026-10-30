import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WaitlistRow } from "@/components/admin/waitlist-row";
import { TopBar } from "@/components/nav/top-bar";
import { Card, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOperatorEmail } from "@/lib/waitlist/operator";
import { listWaitlist } from "@/lib/waitlist/store";

export const metadata: Metadata = { title: "招待の申し込み", robots: { index: false } };

// 運営者の画面: 招待の申し込みの一覧（F19。docs/architecture.md の 4.29）。OPERATOR_ADMIN_EMAILS のアドレスでログインした人だけが開ける。
// ほかの人には、ないページ（404）と同じに見せる
export default async function WaitlistAdminPage() {
  const user = await requireUser();
  if (!isOperatorEmail(user.email)) notFound();
  const entries = await listWaitlist(createAdminClient());
  const dateFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

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
            <b className="text-fg">招待の申し込み</b>
          </span>
        }
        mobileBack={{ href: "/admin", title: "招待の申し込み" }}
      />
      <main className="flex flex-col gap-5 px-12 py-10 max-lg:px-8 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <PageHeader
          title="招待の申し込み"
          sub={`${entries.length} 件・古い順`}
          help="「招待する」で Supabase の招待のメール（パスワードを決めて始める）を送り、申し込みを消します。「お断りする」は、メールを送らずに消します。手順と、招待する人数の目安は docs/deploy.md の 19 にあります。"
        />
        <Card className="overflow-hidden">
                    {entries.length === 0 ? (
            <EmptyState title="申し込みはまだありません" description="トップの「招待を申し込む」から届くと、ここに並びます。" />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {entries.map((e) => (
                <WaitlistRow key={e.id} entry={e} createdAt={dateFormat.format(new Date(e.createdAt))} />
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}
