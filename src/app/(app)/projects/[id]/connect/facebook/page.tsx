import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, NotReadyButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Columns } from "@/components/ui/columns";
import { SnsMark } from "@/components/ui/marks";
import { PageHeader } from "@/components/ui/page-header";
import { Term } from "@/components/ui/term";
import { getProject } from "@/lib/projects/queries";
import { facebookConfigured } from "@/lib/sns/facebook/config";

export const metadata: Metadata = { title: "Facebook ページをつなぐ" };

// Facebook の「つなぐ」の前の確かめ（docs/architecture.md の 4.21）。個人のプロフィールには投稿できないので、ページの作り方を案内する
export default async function ConnectFacebookPage(props: PageProps<"/projects/[id]/connect/facebook">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const ready = facebookConfigured();

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <SnsMark sns="facebook" />
            Facebook ページをつなぐ
          </span>
        }
      />
      <Columns
        main={
          <Card className="flex flex-col gap-4 px-6 py-5 text-[15px] leading-7 max-sm:px-4">
            <p>
             yabumi から Facebook に投稿できるのは、<Term k="facebookPage" />だけです。個人のプロフィール（タイムライン）には投稿できません。
            </p>
            <p className="font-bold">ページがまだないとき</p>
            <ol className="list-decimal pl-5">
              <li>Facebook で「メニュー」→「ページ」→「新しいページを作成」</li>
              <li>ページの名前は、お店・サービス・作品・アプリの名前にするのがおすすめ。カテゴリは、近いもの（「ベーカリー」「教室」「アプリページ」など）を選ぶ</li>
            </ol>
            <section className="flex flex-col gap-1">
              <h2 className="text-[16px] font-bold">気をつけること</h2>
              <ul className="list-disc pl-5 text-muted">
                <li>つなぐと、管理しているページの一覧が出るので、このプロジェクトで投稿するページを 1 つ選びます。別のページでつなぎ直すと、前のページは外れ、予約中の投稿は新しいページから送ります</li>
                <li>ブラウザで今 Facebook にログインしている人が管理するページから選びます。別の人のアカウントにするときは、先に facebook.com で切り替えてください</li>
                <li>投稿を作れる役割（管理者や編集者）を持っているページだけを選べます</li>
                <li>Facebook は、届けたい相手によって読者の多さが大きく違います（地域のお店や教室には向くことがあり、若い世代やアプリには少なめです）。アカウント設計で、Facebook が目的に合うか確かめてから使うのがおすすめです</li>
              </ul>
            </section>
          </Card>
        }
        side={
          <Card>
            <CardHeader title="つなぐ" />
            <div className="flex flex-wrap items-center gap-3 px-6 pt-1 pb-5 max-sm:px-4">
              {ready ? (
                <a href={`/sns/facebook/connect?project=${id}`} className={buttonClass({})}>
                  ページがある・つなぐ
                </a>
              ) : (
                <NotReadyButton>つなぐ</NotReadyButton>
              )}
              <Link href={`/projects/${id}/edit#sns`} className="text-[15px] text-muted hover:text-fg hover:no-underline">
                あとにする
              </Link>
            </div>
          </Card>
        }
        sideFirst
      />
    </div>
  );
}
