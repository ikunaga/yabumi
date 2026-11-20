import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/top-bar";
import { PushSettings } from "@/components/push/push-settings";
import { LearningPrefsForm } from "@/components/settings/learning-prefs-form";
import { AutoPostPrefsForm } from "@/components/settings/auto-post-prefs-form";
import { CommentPrefsForm } from "@/components/settings/comment-prefs-form";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";
import { Card, CardHeader } from "@/components/ui/card";
import { Columns } from "@/components/ui/columns";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/user";
import { DEFAULT_PREFS } from "@/lib/coach/notify-defaults";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "お知らせの設定" };

// 伴走のお知らせの設定（F18、決定 D29。docs/architecture.md の 4.27）。メールとスマホの通知を別々に、送る曜日も
export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("notification_prefs").select("email_mode, push_mode, behind_weekday, learning_enabled, comment_push, auto_post_push").maybeSingle();
  const prefs = { ...DEFAULT_PREFS, ...(data ?? {}) };
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
            <b>お知らせの設定</b>
          </span>
        }
        mobileBack={{ href: "/settings", title: "お知らせの設定" }}
      />
      <main className="flex flex-col gap-5 px-12 py-10 max-lg:px-8 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <PageHeader
          title="お知らせの設定"
          help="アカウントの方針の「週の回数」で、SNS ごとの週の本数を決められます。決めると、週ごとのペースをお知らせします。概要の「いまやること」に、今週の回数を出します。お知らせは、ここで選んだ方法で届きます。"
        />
        <Columns
          main={
            <>
            <Card className="overflow-hidden">
              <CardHeader title="伴走のお知らせ" />
              <NotificationPrefsForm emailMode={prefs.email_mode as never} pushMode={prefs.push_mode as never} behindWeekday={prefs.behind_weekday} />
            </Card>
            <Card className="overflow-hidden">
              <CardHeader title="SNS のコメントのまとめ" />
              <CommentPrefsForm mode={data?.comment_push === "off" ? "off" : "daily"} />
            </Card>
            <Card className="overflow-hidden">
              <CardHeader title="自動投稿の通知" />
              <AutoPostPrefsForm on={data?.auto_post_push ?? true} />
            </Card>
            <Card className="overflow-hidden">
              <CardHeader title="学びの表示（今日の用語・ひとこと）" />
              <LearningPrefsForm enabled={data?.learning_enabled ?? true} />
            </Card>
            </>
          }
          side={
            <>
              <Card className="overflow-hidden">
                <CardHeader title="スマホの通知" />
                <div className="px-6 pt-1 pb-5 max-sm:px-4">
                  <PushSettings />
                </div>
              </Card>
              <Card className="px-6 py-5 text-sm leading-[1.7] text-muted max-sm:px-4">
                メールは <span className="break-all text-fg">{user.email}</span> に届きます。メールの最後の「このお知らせのメールを止める」からも、ログインせずに止められます。
                <Link href="/settings" className="ml-1 font-semibold text-fg hover:underline">
                  ログインと退会
                </Link>
              </Card>
            </>
          }
        />
      </main>
    </>
  );
}
