import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, NotReadyButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Columns } from "@/components/ui/columns";
import { SnsMark } from "@/components/ui/marks";
import { PageHeader } from "@/components/ui/page-header";
import { getProject } from "@/lib/projects/queries";
import { insightsEnabled } from "@/lib/sns/insights/scopes";
import { threadsConfigured } from "@/lib/sns/threads/config";

export const metadata: Metadata = { title: "Threads をつなぐ" };

// Threads の「つなぐ」の前の確かめ。何ができるか、取り消し、外し方を先に知らせる
export default async function ConnectThreadsPage(props: PageProps<"/projects/[id]/connect/threads">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const ready = threadsConfigured();
  const metrics = insightsEnabled("threads");

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <SnsMark sns="threads" />
            Threads をつなぐ
          </span>
        }
      />
      <Columns
        main={
          <Card className="flex flex-col gap-4 px-6 py-5 text-[15px] leading-7 max-sm:px-4">
            <p>
              「つなぐ」を押すと Threads（Meta）の画面が開きます。投稿に使うアカウントでログインし、矢書を「許可」してください。Threads のパスワードは矢書に渡りません。
            </p>

            <section className="flex flex-col gap-1">
              <h2 className="text-[16px] font-bold">矢書ができること</h2>
              <ul className="list-disc pl-5">
                <li>矢書でつくった投稿を、今すぐ、または予約した日時に Threads へ送る（500 字まで、画像は 20 枚まで）</li>
                <li>送った投稿を、投稿の画面の「Threads から取り消す」で Threads の上から消す</li>
                {metrics && <li>送った投稿の閲覧数などと、フォロワー数を読む（分析の画面に出します）</li>}
              </ul>
              <p className="text-muted">あなたが「送る」「予約」を押していない文面を、矢書が勝手に投稿することはありません。費用はかかりません。</p>
            </section>

            <section className="flex flex-col gap-1">
              <h2 className="text-[16px] font-bold">気をつけること</h2>
              <ul className="list-disc pl-5 text-muted">
                <li>Threads のプロフィールがまだないときは、先に Threads のアプリでプロフィールを作ってください</li>
                <li>ブラウザで今 Threads（Instagram）にログインしているアカウントでつながります。別のアカウントにするときは、先に threads.com で切り替えてください</li>
                <li>このプロジェクトでつなげる Threads のアカウントは 1 つです。別のアカウントでつなぎ直すと、前のアカウントは外れ、予約中の投稿は新しいアカウントから送ります</li>
                <li>
                  矢書から外したあと、Threads の側の許可も消すときは、Threads のアプリの「設定 → アカウント → ウェブサイトのアクセス許可」から矢書を削除します
                </li>
              </ul>
            </section>
          </Card>
        }
        side={
          <Card>
            <CardHeader title="つなぐ" />
            <div className="flex flex-wrap items-center gap-3 px-6 pt-1 pb-5 max-sm:px-4">
              {ready ? (
                // 認可画面へのリダイレクトなので、Link（先読みあり）ではなく a で開く
                <a href={`/sns/threads/connect?project=${id}`} className={buttonClass({})}>
                  Threads をつなぐ
                </a>
              ) : (
                <NotReadyButton>Threads をつなぐ</NotReadyButton>
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
