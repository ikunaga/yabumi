import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, NotReadyButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <div className="flex max-w-[720px] flex-col gap-5">
      <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">Facebook ページをつなぐ</h1>
      <Card className="flex flex-col gap-4 p-5 text-[14px] leading-7">
        <p>
          矢書から Facebook に投稿できるのは、<Term k="facebookPage" />だけです。個人のプロフィール（タイムライン）には投稿できません。
        </p>
        <p className="font-bold">ページがまだないとき</p>
        <ol className="list-decimal pl-5">
          <li>Facebook で「メニュー」→「ページ」→「新しいページを作成」</li>
          <li>ページの名前は、アプリの名前にするのがおすすめ。カテゴリは「アプリページ」や「ソフトウェア」など</li>
        </ol>
        <ul className="list-disc pl-5 text-muted">
          <li>つなぐと、管理しているページの一覧が出るので、投稿するページを選びます</li>
          <li>投稿を作れる役割（管理者や編集者）を持っているページだけを選べます</li>
          <li>日本の個人開発者には、Facebook の読者は少なめです。アカウント設計で、Facebook が目的に合うか確かめてから使うのがおすすめです</li>
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          {ready ? (
            <a href={`/sns/facebook/connect?project=${id}`} className={buttonClass({})}>
              ページがある・つなぐ
            </a>
          ) : (
            <NotReadyButton>つなぐ</NotReadyButton>
          )}
          <Link href={`/projects/${id}#sns`} className="font-semibold text-primary hover:underline">
            あとにする
          </Link>
        </div>
      </Card>
    </div>
  );
}
