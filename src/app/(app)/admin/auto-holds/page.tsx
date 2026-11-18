import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoHoldsPanel } from "@/components/admin/auto-hold-forms";
import { TopBar } from "@/components/nav/top-bar";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/user";
import { listAutoPostHolds } from "@/lib/auto-post/holds";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOperatorEmail } from "@/lib/waitlist/operator";

export const metadata: Metadata = { title: "自動の投稿を止める", robots: { index: false } };

// 運営者の画面: 利用者ごとに自動の投稿を止める・解除する・止めている人の一覧（docs/design/auto-post.md の「運営者が止める」、docs/deploy.md の 32）。
// OPERATOR_ADMIN_EMAILS のアドレスでログインした人だけ。ほかの人には 404
export default async function AutoHoldsAdminPage() {
  const user = await requireUser();
  if (!isOperatorEmail(user.email)) notFound();
  const holds = await listAutoPostHolds(createAdminClient());
  const dateFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

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
            <b className="text-fg">自動の投稿を止める</b>
          </span>
        }
        mobileBack={{ href: "/admin", title: "自動の投稿を止める" }}
      />
      <main className="flex flex-col gap-5 px-12 py-10 max-lg:px-8 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <PageHeader
          title="自動の投稿を止める"
          sub={`止めている ${holds.length} 人`}
          help="止めると、その利用者は自動の投稿を作る・再開する・送ることができなくなります（手で作る投稿はそのまま使えます）。利用者には、止めていることと問い合わせ先だけを、画面とスマホの通知で知らせます。理由は見せないので、急ぎでなければ docs/deploy.md の 32 のひな形でメールを送ってください。"
        />
        <AutoHoldsPanel holds={holds.map((h) => ({ ...h, heldAtLabel: dateFormat.format(new Date(h.heldAt)) }))} />
      </main>
    </>
  );
}
