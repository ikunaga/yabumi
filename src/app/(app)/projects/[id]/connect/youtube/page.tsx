import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, NotReadyButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Columns } from "@/components/ui/columns";
import { SnsMark } from "@/components/ui/marks";
import { PageHeader } from "@/components/ui/page-header";
import { getProject } from "@/lib/projects/queries";
import { YOUTUBE_USER_DAILY_UPLOADS, youtubeConfigured, youtubeOAuthTesting } from "@/lib/sns/youtube/config";

export const metadata: Metadata = { title: "YouTube をつなぐ" };

// YouTube の「つなぐ」の前の確かめ（docs/design/youtube.md の 2.・10.）。
// Google の確認の前は「確認されていないアプリ」と出ることと、7 日ごとにつなぎ直しが要ることを先に知らせる
export default async function ConnectYouTubePage(props: PageProps<"/projects/[id]/connect/youtube">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const ready = youtubeConfigured();
  const testing = youtubeOAuthTesting();

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <SnsMark sns="youtube" />
            YouTube をつなぐ
          </span>
        }
      />
      <Columns
        main={
          <Card className="flex flex-col gap-4 px-6 py-5 text-[15px] leading-7 max-sm:px-4">
            <p>「つなぐ」を押すと Google の画面が開きます。YouTube のチャンネルを持っている Google のアカウントでログインし、yabumi に「YouTube への動画の投稿」と「チャンネルの確認」の 2 つを許可してください。Google のパスワードは yabumi に渡りません。</p>

            {testing && (
              <p className="rounded-md bg-surface2 px-3.5 py-2.5 text-[14px] leading-[1.7]">
                <span className="mr-1.5 font-bold text-signal">● 要確認</span>
                いまは、yabumi が Google の確認を受けている途中のため、Google の画面に「このアプリは Google で確認されていません」と出ることがあります。また、つないでから 7 日で許可が切れるので、7 日ごとにつなぎ直しが要ります（yabumi の準備の都合で、あなたのアカウントの問題ではありません）。
              </p>
            )}

            <section className="flex flex-col gap-1">
              <h2 className="text-[16px] font-bold">yabumi ができること</h2>
              <ul className="list-disc pl-5">
                <li>yabumi で選んだ動画を、今すぐ、または予約した日時に、あなたの YouTube のチャンネルへ上げる（タイトル・説明・公開範囲などは、送る前に確かめます）</li>
                <li>投稿の画面に、つないだチャンネルの名前を出す</li>
                <li>上げた動画の YouTube での処理が終わったかを確かめる</li>
              </ul>
              <p className="text-muted">あなたが公開範囲を選んで「送る」「予約」を押していない動画を、yabumi が勝手に上げることはありません。チャンネルにある動画を直したり消したりはしません。</p>
            </section>

            <section className="flex flex-col gap-1">
              <h2 className="text-[16px] font-bold">気をつけること</h2>
              <ul className="list-disc pl-5 text-muted">
                <li>yabumi から YouTube に上げられるのは、1 日 {YOUTUBE_USER_DAILY_UPLOADS} 本までです</li>
                <li>上げた動画を消すときは、YouTube Studio から消してください</li>
                <li>このプロジェクトでつなげるチャンネルは 1 つです。別のチャンネルでつなぎ直すと、前のチャンネルは外れます</li>
                <li>yabumi から YouTube を外すと、Google の側の許可も取り消します。Google のアカウントの設定（security.google.com の「サードパーティ アプリとサービス」）からも、いつでも取り消せます</li>
              </ul>
              <p className="text-muted">
                YouTube に上げると、
                <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" className="underline">
                  YouTube 利用規約
                </a>
                に従うことになります。Google での情報の扱いは
                <a href="https://www.google.com/policies/privacy" target="_blank" rel="noreferrer" className="underline">
                  Google のプライバシーポリシー
                </a>
                のとおりです。
              </p>
            </section>
          </Card>
        }
        side={
          <Card>
            <CardHeader title="つなぐ" />
            <div className="flex flex-wrap items-center gap-3 px-6 pt-1 pb-5 max-sm:px-4">
              {ready ? (
                // 認可画面へのリダイレクトなので、Link（先読みあり）ではなく a で開く
                <a href={`/sns/youtube/connect?project=${id}`} className={buttonClass({})}>
                  YouTube をつなぐ
                </a>
              ) : (
                <NotReadyButton>YouTube をつなぐ</NotReadyButton>
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
