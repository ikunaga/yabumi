import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, NotReadyButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <div className="flex max-w-[720px] flex-col gap-5">
      <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">Threads をつなぐ</h1>
      <Card className="flex flex-col gap-4 p-5 text-[14px] leading-7">
        <p>
          「つなぐ」を押すと Threads（Meta）の画面が開きます。投稿に使うアカウントでログインし、矢書を「許可」してください。Threads のパスワードは矢書に渡りません。
        </p>

        <section className="flex flex-col gap-1">
          <h2 className="font-bold">矢書ができること</h2>
          <ul className="list-disc pl-5">
            <li>矢書でつくった投稿を、今すぐ、または予約した日時に Threads へ送る（500 字まで、画像は 20 枚まで）</li>
            <li>送った投稿を、投稿の画面の「Threads から取り消す」で Threads の上から消す</li>
            {metrics && <li>送った投稿の閲覧数などと、フォロワー数を読む（指標の画面に出します）</li>}
          </ul>
          <p className="text-muted">あなたが「送る」「予約」を押していない文面を、矢書が勝手に投稿することはありません。費用はかかりません。</p>
        </section>

        <ul className="list-disc pl-5 text-muted">
          <li>Threads のプロフィールがまだないときは、先に Threads のアプリでプロフィールを作ってください</li>
          <li>
            矢書から外したあと、Threads の側の許可も消すときは、Threads のアプリの「設定 → アカウント → ウェブサイトのアクセス許可」から矢書を削除します
          </li>
        </ul>

        <div className="flex flex-wrap items-center gap-3">
          {ready ? (
            // 認可画面へのリダイレクトなので、Link（先読みあり）ではなく a で開く
            <a href={`/sns/threads/connect?project=${id}`} className={buttonClass({})}>
              Threads をつなぐ
            </a>
          ) : (
            <NotReadyButton>Threads をつなぐ</NotReadyButton>
          )}
          <Link href={`/projects/${id}#sns`} className="font-semibold text-primary hover:underline">
            あとにする
          </Link>
        </div>
      </Card>
    </div>
  );
}
