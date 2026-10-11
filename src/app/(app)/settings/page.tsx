import type { Metadata } from "next";
import Link from "next/link";
import { WithdrawForm } from "@/components/account/withdraw-form";
import { TopBar } from "@/components/nav/top-bar";
import { Card, CardHeader } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "アカウント" };

// アカウント: メールアドレス、パスワードの変更、退会（docs/architecture.md の 4.14・4.16）
export default async function SettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ count: snsCount }, { count: githubCount }] = await Promise.all([
    supabase.from("social_accounts").select("id", { count: "exact", head: true }).eq("sns", "threads"),
    supabase.from("github_installations").select("installation_id", { count: "exact", head: true }),
  ]);

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
            <b>アカウント</b>
          </span>
        }
        mobileBack={{ href: "/projects", title: "アカウント" }}
      />
      <main className="flex max-w-[720px] flex-col gap-6 px-12 py-12 max-lg:px-6 max-sm:gap-4 max-sm:px-4 max-sm:py-5">
        <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">アカウント</h1>

        <Card className="overflow-hidden">
          <CardHeader title="ログイン" />
          <dl className="flex flex-col gap-3 px-5 py-4 text-[14px]">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <dt className="w-32 text-muted">メールアドレス</dt>
              <dd className="break-all">{user.email}</dd>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <dt className="w-32 text-muted">パスワード</dt>
              <dd>
                <Link href="/reset-password" className="font-semibold text-primary hover:underline">
                  パスワードを変える
                </Link>
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="退会する" />
          <div className="flex flex-col gap-4 px-5 py-4 text-[14px] leading-7">
            <p>退会すると、矢書に保存しているあなたのデータをすべて消します。元に戻せません。</p>
            <ul className="list-disc pl-5">
              <li>消えるもの: アカウント、プロジェクト、アカウント設計、投稿（下書き・予約・送信の記録）、AI との会話、つないだ SNS とそのトークン、GitHub のつながり</li>
              <li>X は、X の側の連携も取り消します。GitHub は、矢書の GitHub App を外します</li>
              <li>
                SNS に送った投稿は消しません。消したい投稿があれば、退会の前に、投稿の画面の「SNS から取り消す」を使ってください
              </li>
              {(snsCount ?? 0) > 0 && (
                <li>Threads の側の連携は、矢書からは外せません。Threads のアプリの「設定 → アカウント → ウェブサイトのアクセス許可」から削除してください</li>
              )}
              {(githubCount ?? 0) > 0 && <li>GitHub App を外せなかったときは、GitHub の Settings → Applications から外せます</li>}
              <li>AI と SNS の API にかかった費用の記録（会話や投稿の中身は含みません）は、あなたとの紐づけを外して 13 か月残します</li>
            </ul>
            <WithdrawForm />
          </div>
        </Card>
      </main>
    </>
  );
}
