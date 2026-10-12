import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/nav/top-bar";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/user";
import { isOperatorEmail } from "@/lib/waitlist/operator";

export const metadata: Metadata = { title: "運営", robots: { index: false } };

// 運営者の画面の入口（OPERATOR_ADMIN_EMAILS のアドレスでログインした人だけ。ほかの人には 404）
export default async function AdminPage() {
  const user = await requireUser();
  if (!isOperatorEmail(user.email)) notFound();
  const items = [
    { href: "/admin/waitlist", title: "招待の申し込み", body: "トップの「招待を申し込む」から届いた申し込みを見て、招待する・お断りする（docs/deploy.md の 19）" },
    { href: "/admin/legal-notice", title: "規約の変更の知らせ", body: "利用規約・プライバシーポリシーの予定の変更を、登録している全員にメールで知らせる（docs/legal.md の D31）" },
  ];
  return (
    <>
      <TopBar email={user.email} crumb={<b>運営</b>} mobileBack={{ href: "/projects", title: "運営" }} />
      <main className="flex max-w-[880px] flex-col gap-6 px-12 py-12 max-lg:px-6 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">運営（運営者だけ）</h1>
        <Card className="overflow-hidden">
          <ul className="flex flex-col divide-y divide-line">
            {items.map((i) => (
              <li key={i.href} className="flex flex-col gap-1 px-5 py-4 text-[14px]">
                <Link href={i.href} className="font-bold text-primary hover:underline">
                  {i.title}
                </Link>
                <span className="leading-[1.7] text-muted">{i.body}</span>
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </>
  );
}
