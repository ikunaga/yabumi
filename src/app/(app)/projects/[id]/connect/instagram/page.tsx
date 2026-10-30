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
import { instagramConfigured } from "@/lib/sns/instagram/config";

export const metadata: Metadata = { title: "Instagram をつなぐ" };

// Instagram の「つなぐ」の前の確かめ（docs/architecture.md の 4.21）。プロアカウントでないとつなげないので、先に切り替え方を案内する
export default async function ConnectInstagramPage(props: PageProps<"/projects/[id]/connect/instagram">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const ready = instagramConfigured();

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <SnsMark sns="instagram" />
            Instagram をつなぐ
          </span>
        }
      />
      <Columns
        main={
          <Card className="flex flex-col gap-4 px-6 py-5 text-[15px] leading-7 max-sm:px-4">
            <p>
              矢書から Instagram に投稿できるのは、<Term k="proAccount" />だけです。無料で、Instagram のアプリから数分で切り替えられます。
            </p>
            <ol className="list-decimal pl-5">
              <li>Instagram のアプリで、右下のプロフィール → 右上の「≡」→「設定とアクティビティ」を開く</li>
              <li>「アカウントの種類とツール」→「プロアカウントに切り替える」</li>
              <li>「クリエイター」か「ビジネス」を選ぶ（迷ったら「クリエイター」。あとから変えられます）</li>
            </ol>
            <section className="flex flex-col gap-1">
              <h2 className="text-[16px] font-bold">気をつけること</h2>
              <ul className="list-disc pl-5 text-muted">
                <li>Facebook ページは要りません</li>
                <li>ブラウザで今 Instagram にログインしているアカウントでつながります。別のアカウントにするときは、先に instagram.com で切り替えてください</li>
                <li>このプロジェクトでつなげる Instagram のアカウントは 1 つです。別のアカウントでつなぎ直すと、前のアカウントは外れ、予約中の投稿は新しいアカウントから送ります</li>
                <li>Instagram には画像が必要です。矢書で投稿をつくるときに、画像を 1 枚以上添えてください（縦横比は 4:5〜1.91:1）</li>
                <li>矢書から送った投稿は、矢書からは取り消せません。消すときは Instagram のアプリから消します</li>
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
                <a href={`/sns/instagram/connect?project=${id}`} className={buttonClass({})}>
                  プロアカウントにした・つなぐ
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
