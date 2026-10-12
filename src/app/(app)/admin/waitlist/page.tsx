import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WaitlistRow } from "@/components/admin/waitlist-row";
import { TopBar } from "@/components/nav/top-bar";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
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
            <Link href="/projects" className="text-primary hover:underline">
              プロジェクト
            </Link>
            <span className="text-muted">/</span>
            <b>招待の申し込み</b>
          </span>
        }
        mobileBack={{ href: "/projects", title: "招待の申し込み" }}
      />
      <main className="flex max-w-[960px] flex-col gap-6 px-12 py-12 max-lg:px-6 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">招待の申し込み（運営者）</h1>
        <p className="text-[14px] leading-[1.8] text-muted">
          申し込みの古い順です。「招待する」で Supabase の招待のメール（パスワードを決めて始める）を送り、申し込みを消します。「お断りする」は、メールを送らずに消します。手順と、招待する人数の目安は docs/deploy.md の 19 にあります。
        </p>
        <Card className="overflow-hidden">
          <CardHeader title={`申し込み ${entries.length} 件`} />
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
