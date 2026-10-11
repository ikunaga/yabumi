import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <div className="flex max-w-[720px] flex-col gap-5">
      <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">Instagram をつなぐ</h1>
      <Card className="flex flex-col gap-4 p-5 text-[14px] leading-7">
        <p>
          矢書から Instagram に投稿できるのは、<Term k="proAccount" />だけです。無料で、Instagram のアプリから数分で切り替えられます。
        </p>
        <ol className="list-decimal pl-5">
          <li>Instagram のアプリで、右下のプロフィール → 右上の「≡」→「設定とアクティビティ」を開く</li>
          <li>「アカウントの種類とツール」→「プロアカウントに切り替える」</li>
          <li>「クリエイター」か「ビジネス」を選ぶ（迷ったら「クリエイター」。あとから変えられます）</li>
        </ol>
        <ul className="list-disc pl-5 text-muted">
          <li>Facebook ページは要りません</li>
          <li>Instagram には画像が必要です。矢書で投稿をつくるときに、画像を 1 枚以上添えてください（縦横比は 4:5〜1.91:1）</li>
          <li>矢書から送った投稿は、矢書からは取り消せません。消すときは Instagram のアプリから消します</li>
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          {ready ? (
            // 認可画面へのリダイレクトなので、Link（先読みあり）ではなく a で開く
            <a href={`/sns/instagram/connect?project=${id}`} className={buttonClass({})}>
              プロアカウントにした・つなぐ
            </a>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted">準備中</span>
              <button type="button" className={buttonClass({})} disabled>
                つなぐ
              </button>
            </span>
          )}
          <Link href={`/projects/${id}#sns`} className="font-semibold text-primary hover:underline">
            あとにする
          </Link>
        </div>
      </Card>
    </div>
  );
}
