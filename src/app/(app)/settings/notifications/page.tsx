import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/top-bar";
import { PushSettings } from "@/components/push/push-settings";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";
import { Card, CardHeader } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/user";
import { DEFAULT_PREFS } from "@/lib/coach/notify-defaults";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "お知らせの設定" };

// 伴走のお知らせの設定（F18、決定 D29。docs/architecture.md の 4.27）。メールとスマホの通知を別々に、送る曜日も
export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("notification_prefs").select("email_mode, push_mode, behind_weekday").maybeSingle();
  const prefs = { ...DEFAULT_PREFS, ...(data ?? {}) };
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
            <b>お知らせの設定</b>
          </span>
        }
        mobileBack={{ href: "/settings", title: "お知らせの設定" }}
      />
      <main className="flex max-w-[720px] flex-col gap-6 px-12 py-12 max-lg:px-6 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">お知らせの設定</h1>
          <p className="text-[14px] leading-[1.8] text-muted">
            アカウント設計の「最初の 1 か月」で SNS ごとの週の投稿の回数を決めると、矢書が週ごとのペースを見守ります（伴走）。概要の一番上に今週のペースを出し、ここで選んだ方法でお知らせします。
          </p>
        </div>
        <Card className="overflow-hidden">
          <CardHeader title="伴走のお知らせ" />
          <NotificationPrefsForm emailMode={prefs.email_mode as never} pushMode={prefs.push_mode as never} behindWeekday={prefs.behind_weekday} />
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="スマホの通知" />
          <div className="px-5 py-4 max-sm:px-4">
            <PushSettings />
          </div>
        </Card>
        <p className="text-xs leading-[1.7] text-muted">
          メールは {user.email} に届きます。メールの最後の「このお知らせのメールを止める」からも、ログインせずに止められます。
          <Link href="/settings" className="ml-1 font-semibold text-primary hover:underline">
            ログインと退会
          </Link>
        </p>
      </main>
    </>
  );
}
