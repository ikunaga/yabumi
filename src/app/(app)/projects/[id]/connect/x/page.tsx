import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, NotReadyButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Term } from "@/components/ui/term";
import { getProject } from "@/lib/projects/queries";
import { insightsEnabled } from "@/lib/sns/insights/scopes";
import { xConfigured, xMetricsUserMonthlyUsd, xMonthlyBudgetUsd, xPostUserMonthlyUsd } from "@/lib/sns/x/config";
import { X_PRICE_USD, formatUsd } from "@/lib/sns/x/pricing";

export const metadata: Metadata = { title: "X をつなぐ" };

// X の「つなぐ」の前の確かめ。X は投稿のたびに費用がかかり、矢書全体の月の上限もあるので、先に知らせる（決定 D16）
export default async function ConnectXPage(props: PageProps<"/projects/[id]/connect/x">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const ready = xConfigured();
  const metrics = insightsEnabled("x");

  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      <h1 className="font-heading text-3xl font-bold max-sm:text-2xl">X（旧 Twitter）をつなぐ</h1>
      <Card className="flex flex-col gap-4 p-5 text-[14px] leading-7">
        <p>「つなぐ」を押すと X の画面が開きます。投稿に使うアカウントでログインし、矢書を「許可」してください。X のパスワードは矢書に渡りません。</p>

        <section className="flex flex-col gap-1">
          <h2 className="font-bold">矢書ができること</h2>
          <ul className="list-disc pl-5">
            <li>矢書でつくった投稿を、今すぐ、または予約した日時に X へ送る（日本語は 140 字まで、画像は 4 枚まで）</li>
            <li>送った投稿を、投稿の画面の「X から取り消す」で X の上から消す</li>
            {metrics && <li>送った投稿の閲覧数などと、フォロワー数を読む（指標の画面に出します）</li>}
          </ul>
          <p className="text-muted">あなたが「送る」「予約」を押していない文面を、矢書が勝手に投稿することはありません。</p>
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="font-bold">費用と月の上限</h2>
          <ul className="list-disc pl-5">
            <li>
              X は、投稿 1 本ごとに<Term k="payPerUse">API の料金</Term>がかかります。いまは矢書が払うので、あなたの支払いはありません
            </li>
            <li>
              1 本 {formatUsd(X_PRICE_USD.post)}（約 2 円）。本文に URL があると {formatUsd(X_PRICE_USD.post_with_url)}（約 30 円）になるので、URL は X のプロフィールに置くのがおすすめです
            </li>
            <li>
              X の投稿（URL つきは 1 本 {formatUsd(X_PRICE_USD.post_with_url)}）は、1 人あたり月 {formatUsd(xPostUserMonthlyUsd())}、矢書全体で月 {formatUsd(xMonthlyBudgetUsd())} までです。どちらかの上限に達すると、その月の残りは X に自動では送りません。投稿の画面の「送信の結果」から、X のアプリで手で投稿して記録できます
            </li>
            {metrics && <li>数字を読むのにも費用がかかるので、1 人あたり月 {formatUsd(xMetricsUserMonthlyUsd())} までにしています（フォロワー数は週に 1 回）</li>}
          </ul>
        </section>

        <ul className="list-disc pl-5 text-muted">
          <li>同じ文面や、ほとんど同じ文面を、複数の X のアカウントに投稿しないでください（X の自動化のルールで禁じられています）</li>
          <li>ブラウザで今 X にログインしているアカウントでつながります。別のアカウントにするときは、先に x.com で切り替えてください</li>
          <li>このプロジェクトでつなげる X のアカウントは 1 つです。別のアカウントでつなぎ直すと、前のアカウントは外れ、予約中の投稿は新しいアカウントから送ります</li>
          <li>矢書から X を外すと、X の側の許可も取り消します</li>
        </ul>

        <div className="flex flex-wrap items-center gap-3">
          {ready ? (
            // 認可画面へのリダイレクトなので、Link（先読みあり）ではなく a で開く
            <a href={`/sns/x/connect?project=${id}`} className={buttonClass({})}>
              X をつなぐ
            </a>
          ) : (
            <NotReadyButton>X をつなぐ</NotReadyButton>
          )}
          <Link href={`/projects/${id}#sns`} className="font-semibold text-primary hover:underline">
            あとにする
          </Link>
        </div>
      </Card>
    </div>
  );
}
