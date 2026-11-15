import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, NotReadyButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Columns } from "@/components/ui/columns";
import { SnsMark } from "@/components/ui/marks";
import { PageHeader } from "@/components/ui/page-header";
import { getProject } from "@/lib/projects/queries";
import { tiktokAudited, tiktokConfigured } from "@/lib/sns/tiktok/config";

export const metadata: Metadata = { title: "TikTok をつなぐ" };

// TikTok の「つなぐ」の前の確かめ（docs/design/tiktok.md の 1. と 9.）。審査の前は「自分だけ」の投稿しかできないことを先に知らせる
export default async function ConnectTikTokPage(props: PageProps<"/projects/[id]/connect/tiktok">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const ready = tiktokConfigured();
  const audited = tiktokAudited();

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <SnsMark sns="tiktok" />
            TikTok をつなぐ
          </span>
        }
      />
      <Columns
        main={
          <Card className="flex flex-col gap-4 px-6 py-5 text-[15px] leading-7 max-sm:px-4">
            <p>「つなぐ」を押すと TikTok の画面が開きます。投稿に使うアカウントでログインし、yabumi を「許可」してください。TikTok のパスワードは yabumi に渡りません。</p>

            {!audited && (
              <p className="rounded-md bg-surface2 px-3.5 py-2.5 text-[14px] leading-[1.7]">
                <span className="mr-1.5 font-bold text-signal">● 要確認</span>
                いまは、yabumi が TikTok の審査を受けている途中のため、TikTok には『自分だけ』に見える投稿しかできません（yabumi の準備の都合で、あなたのアカウントの問題ではありません）。送る前に、TikTok のアカウントを非公開にしてください。審査が終わると、公開範囲を選べるようになります。
              </p>
            )}

            <section className="flex flex-col gap-1">
              <h2 className="text-[16px] font-bold">yabumi ができること</h2>
              <ul className="list-disc pl-5">
                <li>yabumi でつくった写真の投稿を、今すぐ、または予約した日時に TikTok へ送る（タイトルと説明は、TikTok 用に確かめてから送ります）</li>
                <li>TikTok のアプリで仕上げたいときは、TikTok の受信箱に下書きとして送る</li>
                <li>投稿の画面に、つないだ TikTok のニックネームとアイコンを出す</li>
              </ul>
              <p className="text-muted">あなたが TikTok の公開範囲を選んで「送る」「予約」を押していない投稿を、yabumi が勝手に投稿することはありません。</p>
            </section>

            <section className="flex flex-col gap-1">
              <h2 className="text-[16px] font-bold">気をつけること</h2>
              <ul className="list-disc pl-5 text-muted">
                <li>TikTok に直接投稿できるのは、1 つのアカウントで 1 日 15 本ほどまでです（ほかのアプリから送った分も含みます）</li>
                <li>このプロジェクトでつなげる TikTok のアカウントは 1 つです。別のアカウントでつなぎ直すと、前のアカウントは外れます</li>
                <li>yabumi から TikTok を外すと、TikTok の側の許可も取り消します</li>
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
                <a href={`/sns/tiktok/connect?project=${id}`} className={buttonClass({})}>
                  TikTok をつなぐ
                </a>
              ) : (
                <NotReadyButton>TikTok をつなぐ</NotReadyButton>
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
