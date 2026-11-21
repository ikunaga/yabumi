import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/top-bar";
import { AddToHomeGuide } from "@/components/pwa/add-to-home";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/user";
import { vapidPublicKey } from "@/lib/push/send";

export const metadata: Metadata = { title: "ホーム画面に追加する" };

// ホーム画面に追加する案内（2026-11-21 オーナーのタスク。PM 了承）。メニューには置かない（オーナー「メニューが多すぎる」）。
// ホームの帯の「やり方を見る」と、「ログインと退会」「お知らせの設定」から開く
export default async function AddToHomePage() {
  const user = await requireUser();
  // 通知を送れるとき（サーバーに VAPID の鍵があるとき）だけ、通知の行を出す（2026-11-21 オーナーの返事）
  const pushReady = vapidPublicKey() !== null;
  return (
    <>
      <TopBar
        email={user.email}
        crumb={
          <span className="flex items-center gap-2">
            <Link href="/projects" className="hover:text-fg hover:no-underline">
              プロジェクト
            </Link>
            <span className="text-muted">/</span>
            <b>ホーム画面に追加する</b>
          </span>
        }
        mobileBack={{ href: "/settings", title: "ホーム画面に追加する" }}
      />
      <main className="flex flex-col gap-5 px-12 py-10 max-lg:px-8 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <PageHeader title="ホーム画面に追加する" />
        <Card className="flex max-w-2xl flex-col gap-4 px-6 py-5 max-sm:px-4">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] leading-[1.8]">
            <li>アプリのように、画面いっぱいで開けます。</li>
            {pushReady && <li>iPhone・iPad では、スマホの通知を受け取れるようになります。</li>}
            <li>Android では、ほかのアプリの「共有」から、ネタ帳にメモを送れます。</li>
          </ul>
          <AddToHomeGuide />
        </Card>
      </main>
    </>
  );
}
